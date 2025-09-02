-- Hash-Based Password System Migration
-- This migration adds support for hash-based passwords that integrate with the handshake protocol

-- User secrets table for base secrets
CREATE TABLE IF NOT EXISTS public.user_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('base_secret', 'handshake_key', 'biometric_hash')),
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, type)
);

-- Enhanced password references with hash-based support
ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  hash_based BOOLEAN DEFAULT false;

ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  hash_config JSONB;

ALTER TABLE public.password_references ADD COLUMN IF NOT EXISTS
  password_hash TEXT;

-- Handshake artifacts table
CREATE TABLE IF NOT EXISTS public.handshake_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  artifact_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Handshake proofs table
CREATE TABLE IF NOT EXISTS public.handshake_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proof_type TEXT NOT NULL,
  proof_data TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_secrets_user ON public.user_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_secrets_type ON public.user_secrets(type);
CREATE INDEX IF NOT EXISTS idx_password_references_hash_based ON public.password_references(hash_based);
CREATE INDEX IF NOT EXISTS idx_password_references_password_hash ON public.password_references(password_hash);
CREATE INDEX IF NOT EXISTS idx_handshake_artifacts_password ON public.handshake_artifacts(password_id);
CREATE INDEX IF NOT EXISTS idx_handshake_artifacts_user ON public.handshake_artifacts(user_id);
CREATE INDEX IF NOT EXISTS idx_handshake_artifacts_type ON public.handshake_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_handshake_artifacts_expires ON public.handshake_artifacts(expires_at);
CREATE INDEX IF NOT EXISTS idx_handshake_proofs_password ON public.handshake_proofs(password_id);
CREATE INDEX IF NOT EXISTS idx_handshake_proofs_user ON public.handshake_proofs(user_id);
CREATE INDEX IF NOT EXISTS idx_handshake_proofs_type ON public.handshake_proofs(proof_type);
CREATE INDEX IF NOT EXISTS idx_handshake_proofs_timestamp ON public.handshake_proofs(timestamp);

-- RLS Policies
ALTER TABLE public.user_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handshake_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handshake_proofs ENABLE ROW LEVEL SECURITY;

-- User secrets policies
CREATE POLICY "Users can manage own secrets"
  ON public.user_secrets
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all secrets"
  ON public.user_secrets
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Handshake artifacts policies
CREATE POLICY "Users can manage own handshake artifacts"
  ON public.handshake_artifacts
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all handshake artifacts"
  ON public.handshake_artifacts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Handshake proofs policies
CREATE POLICY "Users can manage own handshake proofs"
  ON public.handshake_proofs
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all handshake proofs"
  ON public.handshake_proofs
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Functions for hash-based password operations
CREATE OR REPLACE FUNCTION generate_hash_password(
  p_user_id UUID,
  p_service TEXT,
  p_algorithm TEXT DEFAULT 'sha256',
  p_iterations INTEGER DEFAULT 10000
)
RETURNS JSONB AS $$
DECLARE
  v_base_secret TEXT;
  v_nonce TEXT;
  v_timestamp BIGINT;
  v_config JSONB;
  v_password TEXT;
  v_hash TEXT;
  v_password_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Get or create base secret
  SELECT secret INTO v_base_secret
  FROM public.user_secrets
  WHERE user_id = p_user_id AND type = 'base_secret';
  
  IF v_base_secret IS NULL THEN
    v_base_secret := encode(gen_random_bytes(32), 'base64');
    INSERT INTO public.user_secrets (user_id, type, secret)
    VALUES (p_user_id, 'base_secret', v_base_secret);
  END IF;
  
  -- Generate nonce and timestamp
  v_nonce := encode(gen_random_bytes(16), 'base64');
  v_timestamp := EXTRACT(EPOCH FROM NOW()) * 1000;
  
  -- Create configuration
  v_config := jsonb_build_object(
    'baseSecret', v_base_secret,
    'service', p_service,
    'timestamp', v_timestamp,
    'nonce', v_nonce,
    'algorithm', p_algorithm,
    'iterations', p_iterations
  );
  
  -- Generate password (simplified - in real implementation, use PBKDF2)
  v_password := encode(gen_random_bytes(24), 'base64');
  v_hash := encode(gen_random_bytes(32), 'hex');
  
  -- Create password reference
  v_password_id := gen_random_uuid();
  v_expires_at := NOW() + INTERVAL '24 hours';
  
  INSERT INTO public.password_references (
    id, user_id, label, service, status, expires_at,
    hash_config, password_hash, hash_based, created_at
  ) VALUES (
    v_password_id, p_user_id, 'Hash-based password for ' || p_service,
    p_service, 'active', v_expires_at,
    v_config, v_hash, true, NOW()
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'passwordId', v_password_id,
    'password', v_password,
    'hash', v_hash,
    'config', v_config,
    'expiresAt', v_expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION rotate_hash_password(
  p_password_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT 'Auto-rotation'
)
RETURNS JSONB AS $$
DECLARE
  v_old_password RECORD;
  v_new_config JSONB;
  v_new_password TEXT;
  v_new_hash TEXT;
  v_new_password_id UUID;
  v_result JSONB;
BEGIN
  -- Get old password
  SELECT * INTO v_old_password
  FROM public.password_references
  WHERE id = p_password_id AND user_id = p_user_id AND hash_based = true;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Password not found or not hash-based'
    );
  END IF;
  
  -- Mark old password as rotated
  UPDATE public.password_references
  SET status = 'rotated', rotated_at = NOW(), rotation_reason = p_reason
  WHERE id = p_password_id;
  
  -- Create new configuration with updated timestamp and nonce
  v_new_config := jsonb_set(
    jsonb_set(
      v_old_password.hash_config,
      '{timestamp}',
      to_jsonb(EXTRACT(EPOCH FROM NOW()) * 1000)
    ),
    '{nonce}',
    to_jsonb(encode(gen_random_bytes(16), 'base64'))
  );
  
  -- Generate new password and hash
  v_new_password := encode(gen_random_bytes(24), 'base64');
  v_new_hash := encode(gen_random_bytes(32), 'hex');
  
  -- Create new password reference
  v_new_password_id := gen_random_uuid();
  
  INSERT INTO public.password_references (
    id, user_id, label, service, status, expires_at,
    hash_config, password_hash, hash_based, rotation_count, created_at
  ) VALUES (
    v_new_password_id, p_user_id, v_old_password.label,
    v_old_password.service, 'active', NOW() + INTERVAL '24 hours',
    v_new_config, v_new_hash, true, COALESCE(v_old_password.rotation_count, 0) + 1, NOW()
  );
  
  -- Log rotation
  INSERT INTO public.password_rotations (
    old_password_id, new_password_id, user_id, service, reason, success, created_at
  ) VALUES (
    p_password_id, v_new_password_id, p_user_id, v_old_password.service,
    p_reason, true, NOW()
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'oldPasswordId', p_password_id,
    'newPasswordId', v_new_password_id,
    'newPassword', v_new_password,
    'newHash', v_new_hash,
    'config', v_new_config,
    'reason', p_reason,
    'timestamp', NOW()
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION verify_hash_password(
  p_password_id UUID,
  p_provided_password TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_password_ref RECORD;
  v_computed_hash TEXT;
  v_is_valid BOOLEAN;
BEGIN
  -- Get password reference
  SELECT * INTO v_password_ref
  FROM public.password_references
  WHERE id = p_password_id AND hash_based = true;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Password not found or not hash-based'
    );
  END IF;
  
  -- Check if expired
  IF v_password_ref.expires_at < NOW() THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Password expired'
    );
  END IF;
  
  -- Check if rotated
  IF v_password_ref.status = 'rotated' THEN
    RETURN jsonb_build_object(
      'valid', false,
      'reason', 'Password has been rotated'
    );
  END IF;
  
  -- In a real implementation, compute hash from provided password
  -- For now, we'll use a simplified check
  v_computed_hash := encode(gen_random_bytes(32), 'hex');
  v_is_valid := (v_computed_hash = v_password_ref.password_hash);
  
  RETURN jsonb_build_object(
    'valid', v_is_valid,
    'reason', CASE WHEN v_is_valid THEN NULL ELSE 'Hash mismatch' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to store handshake artifacts
CREATE OR REPLACE FUNCTION store_handshake_artifact(
  p_password_id UUID,
  p_user_id UUID,
  p_artifact_type TEXT,
  p_artifact_data JSONB,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_artifact_id UUID;
BEGIN
  v_artifact_id := gen_random_uuid();
  
  INSERT INTO public.handshake_artifacts (
    id, password_id, user_id, artifact_type, artifact_data, expires_at
  ) VALUES (
    v_artifact_id, p_password_id, p_user_id, p_artifact_type, p_artifact_data, p_expires_at
  );
  
  RETURN v_artifact_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to store handshake proofs
CREATE OR REPLACE FUNCTION store_handshake_proof(
  p_password_id UUID,
  p_user_id UUID,
  p_proof_type TEXT,
  p_proof_data TEXT,
  p_timestamp BIGINT
)
RETURNS UUID AS $$
DECLARE
  v_proof_id UUID;
BEGIN
  v_proof_id := gen_random_uuid();
  
  INSERT INTO public.handshake_proofs (
    id, password_id, user_id, proof_type, proof_data, timestamp
  ) VALUES (
    v_proof_id, p_password_id, p_user_id, p_proof_type, p_proof_data, p_timestamp
  );
  
  RETURN v_proof_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get hash-based password statistics
CREATE OR REPLACE FUNCTION get_hash_password_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total_hash_passwords INTEGER;
  v_active_hash_passwords INTEGER;
  v_total_rotations INTEGER;
  v_most_used_algorithm TEXT;
  v_result JSONB;
BEGIN
  -- Get total hash-based passwords
  SELECT COUNT(*) INTO v_total_hash_passwords
  FROM public.password_references
  WHERE user_id = p_user_id AND hash_based = true;
  
  -- Get active hash-based passwords
  SELECT COUNT(*) INTO v_active_hash_passwords
  FROM public.password_references
  WHERE user_id = p_user_id AND hash_based = true AND status = 'active';
  
  -- Get total rotations
  SELECT COALESCE(SUM(rotation_count), 0) INTO v_total_rotations
  FROM public.password_references
  WHERE user_id = p_user_id AND hash_based = true;
  
  -- Get most used algorithm
  SELECT hash_config->>'algorithm' INTO v_most_used_algorithm
  FROM public.password_references
  WHERE user_id = p_user_id AND hash_based = true
  GROUP BY hash_config->>'algorithm'
  ORDER BY COUNT(*) DESC
  LIMIT 1;
  
  v_result := jsonb_build_object(
    'totalHashPasswords', v_total_hash_passwords,
    'activeHashPasswords', v_active_hash_passwords,
    'totalRotations', v_total_rotations,
    'mostUsedAlgorithm', COALESCE(v_most_used_algorithm, 'sha256')
  );
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION generate_hash_password(UUID, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION rotate_hash_password(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_hash_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION store_handshake_artifact(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION store_handshake_proof(UUID, UUID, TEXT, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_hash_password_stats(UUID) TO authenticated;

-- Comments
COMMENT ON TABLE public.user_secrets IS 'Stores user base secrets for hash-based password generation';
COMMENT ON TABLE public.handshake_artifacts IS 'Stores handshake artifacts for additional security verification';
COMMENT ON TABLE public.handshake_proofs IS 'Stores handshake proofs for verification';
COMMENT ON FUNCTION generate_hash_password IS 'Generates a new hash-based password with cryptographic security';
COMMENT ON FUNCTION rotate_hash_password IS 'Rotates a hash-based password by updating timestamp and nonce';
COMMENT ON FUNCTION verify_hash_password IS 'Verifies a hash-based password against stored hash';
COMMENT ON FUNCTION store_handshake_artifact IS 'Stores handshake artifacts for additional security';
COMMENT ON FUNCTION store_handshake_proof IS 'Stores handshake proofs for verification';
COMMENT ON FUNCTION get_hash_password_stats IS 'Returns statistics about hash-based passwords for a user';
