-- Vault schema and OTAC tables with strict RLS
begin;

create schema if not exists vault;

create table if not exists vault.secrets (
  pointer text not null,
  version integer not null,
  ciphertext bytea not null,
  dek_wrapped bytea not null,
  created_at timestamptz not null default now(),
  primary key (pointer, version)
);

alter table vault.secrets enable row level security;
create policy no_select on vault.secrets for select using (false);
create policy no_insert on vault.secrets for insert with check (false);
create policy no_update on vault.secrets for update using (false);
create policy no_delete on vault.secrets for delete using (false);

-- Application table holding only pointers (no secret/ciphertext)
create table if not exists public.password_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label text,
  pointer text not null unique,
  current_version integer not null default 1,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.password_references enable row level security;
create policy owner_select on public.password_references for select using (auth.uid() = user_id);
create policy owner_insert on public.password_references for insert with check (auth.uid() = user_id);
create policy owner_update on public.password_references for update using (auth.uid() = user_id);

-- One-time authorization code sessions (no secrets)
create table if not exists public.otac_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  code_hash text not null,
  scope jsonb,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.otac_sessions enable row level security;
-- Users can read only their own session metadata; never the code_hash is useful
create policy otac_owner_select on public.otac_sessions for select using (auth.uid() = user_id);
create policy otac_owner_insert on public.otac_sessions for insert with check (auth.uid() = user_id);
create policy otac_owner_update on public.otac_sessions for update using (auth.uid() = user_id);

commit;


