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
