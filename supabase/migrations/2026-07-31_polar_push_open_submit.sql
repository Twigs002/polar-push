-- Operation Polar Push - open submission (no PIN) for the launch.
-- Anyone may submit a pending mandate + upload its document. Verifying /
-- editing / deleting stays admin-only. Standings/OTP already public via views.

drop policy if exists "polar_entries: submit" on public.polar_push_entries;
create policy "polar_entries: submit"
  on public.polar_push_entries for insert to anon, authenticated
  with check ( public.polar_is_admin() or (status = 'pending' and voided = false) );

drop policy if exists "polar mandates: upload" on storage.objects;
create policy "polar mandates: upload"
  on storage.objects for insert to anon, authenticated
  with check ( bucket_id = 'polar-mandates' );

-- Team list readable by anyone (submit dropdown).
drop policy if exists "polar_teams: read" on public.polar_push_teams;
create policy "polar_teams: read"
  on public.polar_push_teams for select to anon, authenticated using (true);
