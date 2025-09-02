create table if not exists public.user_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  last_notified_at timestamptz,
  primary key (user_id, kind)
);

alter table public.user_reminders enable row level security;

drop policy if exists "reminders_select_own" on public.user_reminders;
drop policy if exists "reminders_upsert_own" on public.user_reminders;
create policy "reminders_select_own" on public.user_reminders for select using (auth.uid() = user_id);
create policy "reminders_upsert_own" on public.user_reminders for insert with check (auth.uid() = user_id);
create policy "reminders_update_own" on public.user_reminders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


