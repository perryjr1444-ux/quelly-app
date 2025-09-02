-- Allow inserting password_events when user owns the password
create policy if not exists "insert_password_events_for_owner"
  on public.password_events
  for insert
  with check ( exists (select 1 from public.disposable_passwords p where p.id = password_events.password_id and p.user_id = auth.uid()) );
