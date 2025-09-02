-- Enhanced Session Security Tables

-- User sessions with advanced tracking
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  user_agent TEXT,
  ip_address INET,
  last_ip INET,
  
  -- Geolocation
  geo_country TEXT,
  geo_city TEXT,
  geo_lat NUMERIC(10, 8),
  geo_lon NUMERIC(11, 8),
  
  -- Security
  token_hash TEXT NOT NULL,
  risk_score NUMERIC(3, 2) DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 1),
  verified BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  
  -- Indexes
  CONSTRAINT sessions_token_unique UNIQUE (token_hash)
);

-- Indexes for performance
CREATE INDEX idx_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_sessions_device_id ON public.user_sessions(device_id);
CREATE INDEX idx_sessions_expires_at ON public.user_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_created_at ON public.user_sessions(created_at);
CREATE INDEX idx_sessions_risk_score ON public.user_sessions(risk_score) WHERE risk_score > 0.5;

-- User devices tracking
CREATE TABLE IF NOT EXISTS public.user_devices (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  platform TEXT,
  trust_score NUMERIC(3, 2) DEFAULT 0.5 CHECK (trust_score >= 0 AND trust_score <= 1),
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  times_seen INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (user_id, device_id)
);

-- Security events for anomaly detection
CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.user_sessions(id) ON DELETE CASCADE,
  identifier TEXT,
  endpoint TEXT,
  violations INTEGER DEFAULT 1,
  is_user BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for security events
CREATE INDEX idx_security_events_user_id ON public.security_events(user_id);
CREATE INDEX idx_security_events_type ON public.security_events(event_type);
CREATE INDEX idx_security_events_created_at ON public.security_events(created_at);

-- RLS Policies
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- User sessions policies
CREATE POLICY "Users can view own sessions"
  ON public.user_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all sessions"
  ON public.user_sessions
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- User devices policies
CREATE POLICY "Users can view own devices"
  ON public.user_devices
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all devices"
  ON public.user_devices
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Security events policies (admin only)
CREATE POLICY "Admins can view security events"
  ON public.security_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = auth.uid()
      AND role = 'admin'
    )
  );

-- Function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM public.user_sessions
  WHERE expires_at < NOW()
  AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to detect anomalies
CREATE OR REPLACE FUNCTION detect_session_anomalies()
RETURNS TRIGGER AS $$
DECLARE
  recent_session RECORD;
  time_diff INTERVAL;
  distance NUMERIC;
BEGIN
  -- Check for rapid session creation from different IPs
  SELECT * INTO recent_session
  FROM public.user_sessions
  WHERE user_id = NEW.user_id
  AND id != NEW.id
  AND created_at > NOW() - INTERVAL '5 minutes'
  AND ip_address != NEW.ip_address
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF FOUND THEN
    INSERT INTO public.security_events (
      event_type,
      user_id,
      session_id,
      metadata
    ) VALUES (
      'rapid_session_creation',
      NEW.user_id,
      NEW.id,
      jsonb_build_object(
        'previous_ip', recent_session.ip_address,
        'new_ip', NEW.ip_address,
        'time_diff', EXTRACT(EPOCH FROM (NEW.created_at - recent_session.created_at))
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for anomaly detection
CREATE TRIGGER detect_session_anomalies_trigger
  AFTER INSERT ON public.user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION detect_session_anomalies();

-- Add environment variable requirement comment
COMMENT ON TABLE public.user_sessions IS 'Enhanced session management with security tracking. Requires ENCRYPTION_KEY environment variable for secure token storage.';
