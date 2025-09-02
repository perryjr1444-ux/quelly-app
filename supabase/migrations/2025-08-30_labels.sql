-- Add optional labels to disposable passwords for dogfooding
alter table public.disposable_passwords add column if not exists label text;
create index if not exists idx_disposable_passwords_label on public.disposable_passwords(label);
-- Ensure only one active secret per label per user
create unique index if not exists ux_disposable_passwords_user_label_active on public.disposable_passwords(user_id, label) where status = 'active';
