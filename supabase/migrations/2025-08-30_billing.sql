create table if not exists public.billing_customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete set null,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id)
);

alter table public.billing_customers enable row level security;

create unique index if not exists ux_billing_customers_stripe_customer on public.billing_customers(stripe_customer_id);

-- Allow users to read their own mapping (or members of the org)
drop policy if exists "billing_customers_select_own" on public.billing_customers;
create policy "billing_customers_select_own"
  on public.billing_customers
  for select
  using (
    user_id = auth.uid() or (
      org_id is not null and exists (
        select 1 from public.org_members m where m.org_id = billing_customers.org_id and m.user_id = auth.uid()
      )
    )
  );

-- Note: inserts/updates are done by server using service role (webhooks), so no public insert/update policies.


