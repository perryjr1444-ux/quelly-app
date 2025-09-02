create table if not exists public.credits_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.credits_accounts enable row level security;

drop policy if exists "credits_select_own" on public.credits_accounts;
drop policy if exists "credits_update_own" on public.credits_accounts;
create policy "credits_select_own" on public.credits_accounts for select using (auth.uid() = user_id);
-- Allow users to update their own balance only via RPC (we'll enforce via function), but keep an update policy for service role ops
create policy "credits_update_own" on public.credits_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.credits_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.credits_transactions enable row level security;
drop policy if exists "credits_tx_select_own" on public.credits_transactions;
drop policy if exists "credits_tx_insert_own" on public.credits_transactions;
create policy "credits_tx_select_own" on public.credits_transactions for select using (auth.uid() = user_id);
create policy "credits_tx_insert_own" on public.credits_transactions for insert with check (auth.uid() = user_id);

-- Atomic spend function
create or replace function public.spend_credit(p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
as $$
declare
  rows_updated int;
begin
  -- ensure account row exists
  insert into public.credits_accounts(user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.credits_accounts
  set balance = balance - 1, updated_at = now()
  where user_id = p_user_id and balance > 0;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  if rows_updated = 1 then
    insert into public.credits_transactions(user_id, delta, reason) values (p_user_id, -1, p_reason);
    return true;
  else
    return false;
  end if;
end;
$$;

revoke all on function public.spend_credit(uuid, text) from public;
grant execute on function public.spend_credit(uuid, text) to authenticated;


