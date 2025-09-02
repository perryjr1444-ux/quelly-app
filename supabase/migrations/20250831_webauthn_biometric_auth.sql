-- WebAuthn / Biometric Authentication Support

-- WebAuthn credentials storage
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL CHECK (device_type IN ('platform', 'cross-platform')),
  aaguid TEXT,
  transports TEXT[] DEFAULT '{}',
  user_verified BOOLEAN DEFAULT false,
  disabled BOOLEAN DEFAULT false,
  
  -- Metadata
  device_name TEXT,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint
  CONSTRAINT unique_user_credential UNIQUE (user_id, credential_id)
);

-- Indexes for performance
CREATE INDEX idx_webauthn_user_id ON public.webauthn_credentials(user_id) WHERE NOT disabled;
CREATE INDEX idx_webauthn_credential_id ON public.webauthn_credentials(credential_id);
CREATE INDEX idx_webauthn_last_used ON public.webauthn_credentials(last_used);

-- WebAuthn challenges for verification
CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  
  -- Index for cleanup
  CONSTRAINT webauthn_challenges_unique UNIQUE (user_id, challenge)
);

-- Index for efficient queries and cleanup
CREATE INDEX idx_webauthn_challenges_user ON public.webauthn_challenges(user_id);
CREATE INDEX idx_webauthn_challenges_expires ON public.webauthn_challenges(expires_at);

-- RLS Policies
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- WebAuthn credentials policies
CREATE POLICY "Users can view own credentials"
  ON public.webauthn_credentials
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own credentials"
  ON public.webauthn_credentials
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all credentials"
  ON public.webauthn_credentials
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- WebAuthn challenges policies (service role only)
CREATE POLICY "Service role can manage challenges"
  ON public.webauthn_challenges
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Function to clean up expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_webauthn_challenges()
RETURNS void AS $$
BEGIN
  DELETE FROM public.webauthn_challenges
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check for suspicious WebAuthn activity
CREATE OR REPLACE FUNCTION check_webauthn_activity()
RETURNS TRIGGER AS $$
DECLARE
  recent_failures INTEGER;
BEGIN
  -- Count recent failed attempts
  SELECT COUNT(*) INTO recent_failures
  FROM public.audit_logs
  WHERE user_id = NEW.user_id
  AND action LIKE 'webauthn_%_failed'
  AND created_at > NOW() - INTERVAL '5 minutes';
  
  -- If too many failures, log security event
  IF recent_failures > 5 THEN
    INSERT INTO public.security_events (
      event_type,
      user_id,
      metadata
    ) VALUES (
      'webauthn_brute_force_attempt',
      NEW.user_id,
      jsonb_build_object(
        'failures', recent_failures,
        'credential_id', NEW.credential_id
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for monitoring WebAuthn activity
CREATE TRIGGER monitor_webauthn_activity
  AFTER INSERT OR UPDATE ON public.webauthn_credentials
  FOR EACH ROW
  EXECUTE FUNCTION check_webauthn_activity();

-- Add device trust scores
ALTER TABLE public.user_devices ADD COLUMN IF NOT EXISTS
  webauthn_enabled BOOLEAN DEFAULT false;

ALTER TABLE public.user_devices ADD COLUMN IF NOT EXISTS
  biometric_type TEXT CHECK (biometric_type IN ('fingerprint', 'face', 'iris', 'voice', NULL));

-- Function to get user's authentication methods
CREATE OR REPLACE FUNCTION get_user_auth_methods(p_user_id UUID)
RETURNS TABLE (
  method TEXT,
  enabled BOOLEAN,
  last_used TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  -- Password auth
  SELECT 
    'password'::TEXT as method,
    true as enabled,
    NULL::TIMESTAMPTZ as last_used
  FROM auth.users
  WHERE id = p_user_id
  
  UNION ALL
  
  -- 2FA
  SELECT 
    '2fa'::TEXT,
    COALESCE(tfs.enabled, false),
    NULL::TIMESTAMPTZ
  FROM auth.users u
  LEFT JOIN public.two_factor_secrets tfs ON u.id = tfs.user_id
  WHERE u.id = p_user_id
  
  UNION ALL
  
  -- WebAuthn
  SELECT 
    'webauthn'::TEXT,
    COUNT(*) > 0,
    MAX(last_used)
  FROM public.webauthn_credentials
  WHERE user_id = p_user_id
  AND NOT disabled
  
  UNION ALL
  
  -- Biometric (platform authenticators)
  SELECT 
    'biometric'::TEXT,
    COUNT(*) > 0,
    MAX(last_used)
  FROM public.webauthn_credentials
  WHERE user_id = p_user_id
  AND device_type = 'platform'
  AND NOT disabled;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_auth_methods(UUID) TO authenticated;

-- Add comment
COMMENT ON TABLE public.webauthn_credentials IS 'WebAuthn/FIDO2 credentials for biometric and security key authentication';
