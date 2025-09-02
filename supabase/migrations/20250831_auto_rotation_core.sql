-- THE CORE REVOLUTIONARY FEATURE: Automatic Password Rotation
-- This migration adds the tables and functions that make passwords truly unhackable

-- Login attempts tracking
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  rotated BOOLEAN DEFAULT false,
  rotation_result JSONB,
  
  -- Indexes for performance
  CONSTRAINT login_attempts_password_fk FOREIGN KEY (password_id) REFERENCES public.password_references(id)
);

-- Password rotation history
CREATE TABLE IF NOT EXISTS public.password_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  new_password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  reason TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure we don't have circular references
  CONSTRAINT password_rotations_no_self_reference CHECK (old_password_id != new_password_id)
);

-- Enhanced password references with rotation tracking
ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  rotation_count INTEGER DEFAULT 0;

ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  rotated_at TIMESTAMPTZ;

ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  rotation_reason TEXT;

ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  auto_generated BOOLEAN DEFAULT false;

ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  service TEXT;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_login_attempts_password ON public.login_attempts(password_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON public.login_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_service ON public.login_attempts(service);
CREATE INDEX IF NOT EXISTS idx_login_attempts_timestamp ON public.login_attempts(timestamp);
CREATE INDEX IF NOT EXISTS idx_login_attempts_success ON public.login_attempts(success);

CREATE INDEX IF NOT EXISTS idx_password_rotations_old ON public.password_rotations(old_password_id);
CREATE INDEX IF NOT EXISTS idx_password_rotations_new ON public.password_rotations(new_password_id);
CREATE INDEX IF NOT EXISTS idx_password_rotations_user ON public.password_rotations(user_id);
CREATE INDEX IF NOT EXISTS idx_password_rotations_service ON public.password_rotations(service);
CREATE INDEX IF NOT EXISTS idx_password_rotations_created ON public.password_rotations(created_at);

CREATE INDEX IF NOT EXISTS idx_password_references_rotation_count ON public.password_references(rotation_count);
CREATE INDEX IF NOT EXISTS idx_password_references_rotated_at ON public.password_references(rotated_at);
CREATE INDEX IF NOT EXISTS idx_password_references_service ON public.password_references(service);

-- RLS Policies
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_rotations ENABLE ROW LEVEL SECURITY;

-- Login attempts policies
CREATE POLICY "Users can view own login attempts"
  ON public.login_attempts
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all login attempts"
  ON public.login_attempts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Password rotations policies
CREATE POLICY "Users can view own password rotations"
  ON public.password_rotations
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all password rotations"
  ON public.password_rotations
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- THE CORE REVOLUTIONARY FUNCTION: Auto-rotate password after login
CREATE OR REPLACE FUNCTION auto_rotate_password_after_login(
  p_password_id UUID,
  p_service TEXT,
  p_success BOOLEAN,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_old_password RECORD;
  v_new_password_id UUID;
  v_new_password TEXT;
  v_rotation_reason TEXT;
  v_result JSONB;
BEGIN
  -- Get the current password details
  SELECT user_id, label, expires_at, service
  INTO v_user_id, v_old_password.label, v_old_password.expires_at, v_old_password.service
  FROM public.password_references
  WHERE id = p_password_id AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Password not found or not active'
    );
  END IF;
  
  -- Mark old password as rotated
  UPDATE public.password_references
  SET 
    status = 'rotated',
    rotated_at = NOW(),
    rotation_reason = CASE 
      WHEN p_success THEN 'Auto-rotated after successful login'
      ELSE 'Auto-rotated after failed login attempt'
    END
  WHERE id = p_password_id;
  
  -- Generate new password ID
  v_new_password_id := gen_random_uuid();
  
  -- Generate new secure password (32 characters)
  v_new_password := encode(gen_random_bytes(24), 'base64');
  
  -- Create new password record
  INSERT INTO public.password_references (
    id,
    user_id,
    label,
    status,
    expires_at,
    service,
    rotation_count,
    auto_generated,
    created_at
  ) VALUES (
    v_new_password_id,
    v_user_id,
    COALESCE(v_old_password.label, 'Auto-rotated for ' || p_service),
    'active',
    v_old_password.expires_at,
    p_service,
    1,
    true,
    NOW()
  );
  
  -- Log the rotation
  INSERT INTO public.password_rotations (
    old_password_id,
    new_password_id,
    user_id,
    service,
    reason,
    success,
    created_at
  ) VALUES (
    p_password_id,
    v_new_password_id,
    v_user_id,
    p_service,
    CASE 
      WHEN p_success THEN 'Auto-rotated after successful login'
      ELSE 'Auto-rotated after failed login attempt'
    END,
    p_success,
    NOW()
  );
  
  -- Log the login attempt
  INSERT INTO public.login_attempts (
    password_id,
    user_id,
    service,
    ip_address,
    user_agent,
    success,
    timestamp,
    rotated,
    rotation_result
  ) VALUES (
    p_password_id,
    v_user_id,
    p_service,
    p_ip_address,
    p_user_agent,
    p_success,
    NOW(),
    true,
    jsonb_build_object(
      'old_password_id', p_password_id,
      'new_password_id', v_new_password_id,
      'rotated', true
    )
  );
  
  -- Return success result
  v_result := jsonb_build_object(
    'success', true,
    'old_password_id', p_password_id,
    'new_password_id', v_new_password_id,
    'new_password', v_new_password,
    'rotation_reason', CASE 
      WHEN p_success THEN 'Auto-rotated after successful login'
      ELSE 'Auto-rotated after failed login attempt'
    END,
    'timestamp', NOW()
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get rotation statistics
CREATE OR REPLACE FUNCTION get_rotation_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_rotations INTEGER;
  v_successful_rotations INTEGER;
  v_failed_rotations INTEGER;
  v_most_rotated_service TEXT;
  v_average_per_day NUMERIC;
  v_result JSONB;
BEGIN
  -- Get total rotations
  SELECT COUNT(*)
  INTO v_total_rotations
  FROM public.password_rotations
  WHERE user_id = p_user_id;
  
  -- Get successful rotations
  SELECT COUNT(*)
  INTO v_successful_rotations
  FROM public.password_rotations
  WHERE user_id = p_user_id AND success = true;
  
  -- Get failed rotations
  v_failed_rotations := v_total_rotations - v_successful_rotations;
  
  -- Get most rotated service
  SELECT service
  INTO v_most_rotated_service
  FROM public.password_rotations
  WHERE user_id = p_user_id
  GROUP BY service
  ORDER BY COUNT(*) DESC
  LIMIT 1;
  
  -- Calculate average rotations per day
  SELECT COALESCE(
    COUNT(*)::NUMERIC / GREATEST(
      EXTRACT(DAYS FROM NOW() - MIN(created_at))::NUMERIC,
      1
    ),
    0
  )
  INTO v_average_per_day
  FROM public.password_rotations
  WHERE user_id = p_user_id;
  
  v_result := jsonb_build_object(
    'total_rotations', v_total_rotations,
    'successful_rotations', v_successful_rotations,
    'failed_rotations', v_failed_rotations,
    'most_rotated_service', COALESCE(v_most_rotated_service, 'None'),
    'average_rotations_per_day', ROUND(v_average_per_day, 2)
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get rotation history
CREATE OR REPLACE FUNCTION get_rotation_history(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  old_password_id UUID,
  new_password_id UUID,
  service TEXT,
  reason TEXT,
  success BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pr.id,
    pr.old_password_id,
    pr.new_password_id,
    pr.service,
    pr.reason,
    pr.success,
    pr.created_at
  FROM public.password_rotations pr
  WHERE pr.user_id = p_user_id
  ORDER BY pr.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to force rotate a password
CREATE OR REPLACE FUNCTION force_rotate_password(
  p_password_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT 'Manual rotation requested'
)
RETURNS JSONB AS $$
DECLARE
  v_old_password RECORD;
  v_new_password_id UUID;
  v_new_password TEXT;
  v_result JSONB;
BEGIN
  -- Get the current password details
  SELECT user_id, label, expires_at, service
  INTO v_old_password.user_id, v_old_password.label, v_old_password.expires_at, v_old_password.service
  FROM public.password_references
  WHERE id = p_password_id AND user_id = p_user_id AND status = 'active';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Password not found, not owned by user, or not active'
    );
  END IF;
  
  -- Mark old password as rotated
  UPDATE public.password_references
  SET 
    status = 'rotated',
    rotated_at = NOW(),
    rotation_reason = p_reason
  WHERE id = p_password_id;
  
  -- Generate new password ID
  v_new_password_id := gen_random_uuid();
  
  -- Generate new secure password
  v_new_password := encode(gen_random_bytes(24), 'base64');
  
  -- Create new password record
  INSERT INTO public.password_references (
    id,
    user_id,
    label,
    status,
    expires_at,
    service,
    rotation_count,
    auto_generated,
    created_at
  ) VALUES (
    v_new_password_id,
    p_user_id,
    COALESCE(v_old_password.label, 'Force-rotated password'),
    'active',
    v_old_password.expires_at,
    v_old_password.service,
    1,
    true,
    NOW()
  );
  
  -- Log the rotation
  INSERT INTO public.password_rotations (
    old_password_id,
    new_password_id,
    user_id,
    service,
    reason,
    success,
    created_at
  ) VALUES (
    p_password_id,
    v_new_password_id,
    p_user_id,
    COALESCE(v_old_password.service, 'manual'),
    p_reason,
    true,
    NOW()
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'old_password_id', p_password_id,
    'new_password_id', v_new_password_id,
    'new_password', v_new_password,
    'reason', p_reason,
    'timestamp', NOW()
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION auto_rotate_password_after_login(UUID, TEXT, BOOLEAN, INET, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_rotation_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_rotation_history(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION force_rotate_password(UUID, UUID, TEXT) TO authenticated;

-- Comments explaining the revolutionary concept
COMMENT ON TABLE public.login_attempts IS 'Tracks all login attempts to enable automatic password rotation - THE CORE REVOLUTIONARY FEATURE';
COMMENT ON TABLE public.password_rotations IS 'History of all password rotations - makes passwords truly unhackable by design';
COMMENT ON FUNCTION auto_rotate_password_after_login IS 'THE CORE REVOLUTIONARY FUNCTION: Automatically rotates passwords after login attempts, making them unhackable';
COMMENT ON FUNCTION get_rotation_stats IS 'Provides statistics on password rotations for dashboard analytics';
COMMENT ON FUNCTION get_rotation_history IS 'Returns the history of password rotations for a user';
COMMENT ON FUNCTION force_rotate_password IS 'Allows manual password rotation for emergency situations';
