create extension if not exists "pgcrypto";

create table if not exists public.disposable_passwords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  password text not null,
  status text not null check (status in ('active','used')),
  created_at timestamptz not null default now()
);

alter table public.disposable_passwords enable row level security;

create policy "select_own_passwords"
  on public.disposable_passwords
  for select
  using (auth.uid() = user_id);

create policy "insert_own_passwords"
  on public.disposable_passwords
  for insert
  with check (auth.uid() = user_id);

create policy "update_own_passwords"
  on public.disposable_passwords
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_disposable_passwords_user_created_at
  on public.disposable_passwords (user_id, created_at desc);
create extension if not exists "pgcrypto";

create table if not exists public.password_events (
  id uuid primary key default gen_random_uuid(),
  password_id uuid not null references public.disposable_passwords(id) on delete cascade,
  event text not null check (event in ('created','used','rotated','revoked')),
  created_at timestamptz not null default now()
);

alter table public.password_events enable row level security;

create policy "select_password_events_for_owner"
  on public.password_events
  for select
  using ( exists (select 1 from public.disposable_passwords p where p.id = password_events.password_id and p.user_id = auth.uid()) );

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.orgs enable row level security;

create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.org_members enable row level security;

create policy "select_own_membership"
  on public.org_members
  for select
  using ( user_id = auth.uid() );

-- Now that org_members exists, create policy on orgs that references it
create policy "select_orgs_member_or_owner"
  on public.orgs
  for select
  using ( owner_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = orgs.id and m.user_id = auth.uid()) );

create table if not exists public.entitlements (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  plan text not null default 'free',
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

create policy "select_entitlements_member"
  on public.entitlements
  for select
  using ( exists (select 1 from public.org_members m where m.org_id = entitlements.org_id and m.user_id = auth.uid()) or exists (select 1 from public.orgs o where o.id = entitlements.org_id and o.owner_id = auth.uid()) );
-- Allow inserting password_events when user owns the password
drop policy if exists "insert_password_events_for_owner" on public.password_events;
create policy "insert_password_events_for_owner"
  on public.password_events
  for insert
  with check ( exists (select 1 from public.disposable_passwords p where p.id = password_events.password_id and p.user_id = auth.uid()) );
-- Add optional labels to disposable passwords for dogfooding
alter table public.disposable_passwords add column if not exists label text;
create index if not exists idx_disposable_passwords_label on public.disposable_passwords(label);
-- Ensure only one active secret per label per user
create unique index if not exists ux_disposable_passwords_user_label_active on public.disposable_passwords(user_id, label) where status = 'active';
create table if not exists public.check_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  hash text not null,
  status text not null check (status in ('active','revoked')) default 'active',
  version int not null default 1,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.check_credentials enable row level security;

create index if not exists idx_check_credentials_user_created on public.check_credentials(user_id, created_at desc);
create index if not exists idx_check_credentials_label on public.check_credentials(label);
create unique index if not exists ux_check_credentials_user_label_active on public.check_credentials(user_id, label) where status = 'active';

drop policy if exists "check_creds_select_own" on public.check_credentials;
drop policy if exists "check_creds_insert_own" on public.check_credentials;
drop policy if exists "check_creds_update_own" on public.check_credentials;
create policy "check_creds_select_own" on public.check_credentials for select using (auth.uid() = user_id);
create policy "check_creds_insert_own" on public.check_credentials for insert with check (auth.uid() = user_id);
create policy "check_creds_update_own" on public.check_credentials for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.check_events (
  id uuid primary key default gen_random_uuid(),
  cred_id uuid not null references public.check_credentials(id) on delete cascade,
  event text not null check (event in ('issued','verified','rotated','revoked','failed')),
  created_at timestamptz not null default now()
);

alter table public.check_events enable row level security;
drop policy if exists "check_events_select_own" on public.check_events;
drop policy if exists "check_events_insert_own" on public.check_events;
create policy "check_events_select_own" on public.check_events for select using (exists (select 1 from public.check_credentials c where c.id = cred_id and c.user_id = auth.uid()));
create policy "check_events_insert_own" on public.check_events for insert with check (exists (select 1 from public.check_credentials c where c.id = cred_id and c.user_id = auth.uid()));
