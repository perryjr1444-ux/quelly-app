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

create policy "select_orgs_member_or_owner"
  on public.orgs
  for select
  using ( owner_id = auth.uid() or exists (select 1 from public.org_members m where m.org_id = orgs.id and m.user_id = auth.uid()) );

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
