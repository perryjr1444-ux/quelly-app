create table if not exists public.billing_config (
  id text primary key default 'default',
  product_id text,
  price_id text,
  webhook_endpoint_id text,
  webhook_secret text,
  created_at timestamptz not null default now()
);

alter table public.billing_config enable row level security;

-- No public read/write. Admin-only via service role.
drop policy if exists billing_config_public_select on public.billing_config;
drop policy if exists billing_config_public_update on public.billing_config;


