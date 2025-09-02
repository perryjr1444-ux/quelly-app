-- Two-factor authentication tables
create table if not exists public.two_factor_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret text not null, -- Encrypted TOTP secret
  backup_codes text[] not null, -- Hashed backup codes
  used_backup_codes text[] default '{}',
  enabled boolean not null default false,
  verified_at timestamptz,
  last_used_counter bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- User sessions table for enhanced session management
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text,
  user_agent text,
  ip_address text,
  last_activity timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_user_sessions_user_id on public.user_sessions(user_id);
create index idx_user_sessions_expires on public.user_sessions(expires_at);
create index idx_user_sessions_device on public.user_sessions(device_id) where device_id is not null;

-- Row Level Security
alter table public.two_factor_secrets enable row level security;
alter table public.user_sessions enable row level security;

-- Two-factor secrets policies
-- Users can only see their own 2FA status
create policy "two_factor_secrets_owner_select" on public.two_factor_secrets
  for select using (auth.uid() = user_id);

-- Users can update their own 2FA settings
create policy "two_factor_secrets_owner_update" on public.two_factor_secrets
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can insert their own 2FA settings
create policy "two_factor_secrets_owner_insert" on public.two_factor_secrets
  for insert with check (auth.uid() = user_id);

-- Users can delete their own 2FA settings
create policy "two_factor_secrets_owner_delete" on public.two_factor_secrets
  for delete using (auth.uid() = user_id);

-- Session policies
-- Users can see their own sessions
create policy "user_sessions_owner_select" on public.user_sessions
  for select using (auth.uid() = user_id);

-- System can manage all sessions (via service role)
create policy "user_sessions_system_all" on public.user_sessions
  for all using (true);

-- Function to clean up expired sessions
create or replace function cleanup_expired_sessions()
returns void as $$
begin
  delete from public.user_sessions
  where expires_at < now() or revoked_at is not null;
end;
$$ language plpgsql security definer;

-- Trigger to update the updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_two_factor_secrets_updated_at
  before update on public.two_factor_secrets
  for each row
  execute function update_updated_at_column();
