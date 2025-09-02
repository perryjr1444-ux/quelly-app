-- Complete Enhancement Migration
-- This migration adds all the remaining tables and features for the enhanced PoofPass

-- Team Management Tables
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer', 'guest')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'invited')),
  permissions JSONB NOT NULL DEFAULT '{}',
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer', 'guest')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

-- Password Sharing Tables
CREATE TABLE IF NOT EXISTS public.password_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  encrypted_data TEXT NOT NULL,
  ephemeral_public_key TEXT NOT NULL,
  sender_public_key TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE TABLE IF NOT EXISTS public.password_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  password_id UUID NOT NULL REFERENCES public.password_references(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}',
  revoked BOOLEAN DEFAULT false,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ
);

-- Shared Vaults
CREATE TABLE IF NOT EXISTS public.shared_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vault_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES public.shared_vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backup and Recovery Tables
CREATE TABLE IF NOT EXISTS public.backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'full' CHECK (type IN ('full', 'incremental', 'differential')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  size BIGINT,
  checksum TEXT,
  options JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.backup_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interval_hours INTEGER NOT NULL DEFAULT 24,
  retention_days INTEGER NOT NULL DEFAULT 30,
  options JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_run TIMESTAMPTZ
);

-- Analytics and Metrics Tables
CREATE TABLE IF NOT EXISTS public.analytics_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.analytics_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Settings and Preferences
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}',
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Notification System
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

-- Indexes for Performance
CREATE INDEX idx_organizations_owner ON public.organizations(owner_id);
CREATE INDEX idx_organizations_slug ON public.organizations(slug);
CREATE INDEX idx_team_members_org ON public.team_members(organization_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);
CREATE INDEX idx_team_invitations_token ON public.team_invitations(token);
CREATE INDEX idx_team_invitations_email ON public.team_invitations(email);
CREATE INDEX idx_password_shares_sender ON public.password_shares(sender_id);
CREATE INDEX idx_password_shares_recipient ON public.password_shares(recipient_email);
CREATE INDEX idx_password_access_user ON public.password_access(user_id);
CREATE INDEX idx_password_access_password ON public.password_access(password_id);
CREATE INDEX idx_shared_vaults_org ON public.shared_vaults(organization_id);
CREATE INDEX idx_vault_access_vault ON public.vault_access(vault_id);
CREATE INDEX idx_vault_access_user ON public.vault_access(user_id);
CREATE INDEX idx_backups_user ON public.backups(user_id);
CREATE INDEX idx_backups_status ON public.backups(status);
CREATE INDEX idx_backup_schedules_user ON public.backup_schedules(user_id);
CREATE INDEX idx_analytics_metrics_type ON public.analytics_metrics(type);
CREATE INDEX idx_analytics_metrics_timestamp ON public.analytics_metrics(timestamp);
CREATE INDEX idx_user_settings_user ON public.user_settings(user_id);
CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_read ON public.notifications(read);
CREATE INDEX idx_notifications_created ON public.notifications(created_at);

-- RLS Policies
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Organization Policies
CREATE POLICY "Users can view own organizations"
  ON public.organizations
  FOR SELECT
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE organization_id = organizations.id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can manage organizations"
  ON public.organizations
  FOR ALL
  USING (owner_id = auth.uid());

-- Team Member Policies
CREATE POLICY "Users can view team members in their organizations"
  ON public.team_members
  FOR SELECT
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.organization_id = team_members.organization_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
    )
  );

CREATE POLICY "Admins can manage team members"
  ON public.team_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.organization_id = team_members.organization_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('owner', 'admin')
      AND tm.status = 'active'
    )
  );

-- Password Share Policies
CREATE POLICY "Users can view own password shares"
  ON public.password_shares
  FOR SELECT
  USING (sender_id = auth.uid());

CREATE POLICY "Users can create password shares"
  ON public.password_shares
  FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can update own password shares"
  ON public.password_shares
  FOR UPDATE
  USING (sender_id = auth.uid());

-- Password Access Policies
CREATE POLICY "Users can view own password access"
  ON public.password_access
  FOR SELECT
  USING (user_id = auth.uid());

-- Shared Vault Policies
CREATE POLICY "Users can view vaults in their organizations"
  ON public.shared_vaults
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.organization_id = shared_vaults.organization_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
    )
  );

-- Backup Policies
CREATE POLICY "Users can manage own backups"
  ON public.backups
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own backup schedules"
  ON public.backup_schedules
  FOR ALL
  USING (user_id = auth.uid());

-- User Settings Policies
CREATE POLICY "Users can manage own settings"
  ON public.user_settings
  FOR ALL
  USING (user_id = auth.uid());

-- Notification Policies
CREATE POLICY "Users can view own notifications"
  ON public.notifications
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  USING (user_id = auth.uid());

-- Service Role Policies (for system operations)
CREATE POLICY "Service role can manage all data"
  ON public.organizations
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage all team data"
  ON public.team_members
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage all shares"
  ON public.password_shares
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage all backups"
  ON public.backups
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage all analytics"
  ON public.analytics_metrics
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Functions for cleanup and maintenance
CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS void AS $$
BEGIN
  UPDATE public.team_invitations
  SET status = 'expired'
  WHERE status = 'pending'
  AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_expired_shares()
RETURNS void AS $$
BEGIN
  UPDATE public.password_shares
  SET status = 'expired'
  WHERE status = 'pending'
  AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_old_backups()
RETURNS void AS $$
BEGIN
  DELETE FROM public.backups
  WHERE expires_at < NOW()
  AND status = 'completed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cleanup_old_analytics()
RETURNS void AS $$
BEGIN
  DELETE FROM public.analytics_metrics
  WHERE timestamp < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggers for automatic updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_members_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_shared_vaults_updated_at
  BEFORE UPDATE ON public.shared_vaults
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Comments
COMMENT ON TABLE public.organizations IS 'Multi-tenant organization structure with role-based access control';
COMMENT ON TABLE public.team_members IS 'Organization membership with granular permissions';
COMMENT ON TABLE public.password_shares IS 'End-to-end encrypted password sharing with time limits';
COMMENT ON TABLE public.shared_vaults IS 'Organization-wide password vaults for team collaboration';
COMMENT ON TABLE public.backups IS 'Encrypted backup storage with integrity verification';
COMMENT ON TABLE public.analytics_metrics IS 'Real-time performance and business metrics';
COMMENT ON TABLE public.notifications IS 'User notification system with real-time delivery';
