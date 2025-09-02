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

create policy if not exists "check_creds_select_own" on public.check_credentials for select using (auth.uid() = user_id);
create policy if not exists "check_creds_insert_own" on public.check_credentials for insert with check (auth.uid() = user_id);
create policy if not exists "check_creds_update_own" on public.check_credentials for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.check_events (
  id uuid primary key default gen_random_uuid(),
  cred_id uuid not null references public.check_credentials(id) on delete cascade,
  event text not null check (event in ('issued','verified','rotated','revoked','failed')),
  created_at timestamptz not null default now()
);

alter table public.check_events enable row level security;
create policy if not exists "check_events_select_own" on public.check_events for select using (exists (select 1 from public.check_credentials c where c.id = cred_id and c.user_id = auth.uid()));
create policy if not exists "check_events_insert_own" on public.check_events for insert with check (exists (select 1 from public.check_credentials c where c.id = cred_id and c.user_id = auth.uid()));
