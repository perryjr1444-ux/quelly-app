-- Audit logs table for comprehensive activity tracking
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  timestamp timestamptz not null default now(),
  action text not null,
  resource_type text not null,
  resource_id text,
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb,
  ip_address text,
  user_agent text,
  request_id text,
  duration_ms integer,
  status text not null check (status in ('success', 'failure', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

-- Indexes for efficient querying
create index idx_audit_logs_timestamp on public.audit_logs(timestamp desc);
create index idx_audit_logs_user_id on public.audit_logs(user_id) where user_id is not null;
create index idx_audit_logs_action on public.audit_logs(action);
create index idx_audit_logs_resource on public.audit_logs(resource_type, resource_id);
create index idx_audit_logs_request_id on public.audit_logs(request_id) where request_id is not null;
create index idx_audit_logs_status on public.audit_logs(status);

-- Security events table for high-priority security incidents
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  identifier text not null,
  endpoint text,
  violations integer,
  is_user boolean default false,
  data jsonb,
  created_at timestamptz not null default now()
);

create index idx_security_events_type on public.security_events(event_type);
create index idx_security_events_identifier on public.security_events(identifier);
create index idx_security_events_created on public.security_events(created_at desc);

-- Row Level Security
alter table public.audit_logs enable row level security;
alter table public.security_events enable row level security;

-- Only admins can view audit logs
create policy "audit_logs_admin_select" on public.audit_logs
  for select using (
    exists (
      select 1 from public.org_members 
      where user_id = auth.uid() 
      and role = 'admin'
    )
  );

-- System can insert audit logs (via service role)
create policy "audit_logs_system_insert" on public.audit_logs
  for insert with check (true);

-- Only admins can view security events
create policy "security_events_admin_select" on public.security_events
  for select using (
    exists (
      select 1 from public.org_members 
      where user_id = auth.uid() 
      and role = 'admin'
    )
  );

-- System can insert security events
create policy "security_events_system_insert" on public.security_events
  for insert with check (true);

-- Function to automatically clean up old audit logs (keep 90 days)
create or replace function cleanup_old_audit_logs()
returns void as $$
begin
  delete from public.audit_logs
  where timestamp < now() - interval '90 days';
  
  delete from public.security_events
  where created_at < now() - interval '30 days';
end;
$$ language plpgsql security definer;

-- Create a scheduled job to run cleanup daily (requires pg_cron extension)
-- Note: pg_cron must be enabled in Supabase dashboard
-- select cron.schedule('cleanup-audit-logs', '0 2 * * *', 'select cleanup_old_audit_logs();');
