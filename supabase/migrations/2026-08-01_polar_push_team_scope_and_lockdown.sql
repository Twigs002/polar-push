-- Operation Polar Push - team-scoped submissions + lock down to logged-in staff.
-- =================================================================
-- Applied live via the SQL editor; recorded here for repo/prod parity.
-- Model: everyone (logged in) sees ALL teams' standings/OTP (via the postgres-
-- owned views), but raw entries (submissions) are scoped to the caller's own
-- team(s) held in staff.teams (text[]). Login is required, so anon access to
-- the public views and the submit/upload/teams surfaces is revoked.

-- staff.teams (text[]) is populated per user from the boarding directory
-- (see the one-off UPDATE run in the SQL editor).
alter table public.staff add column if not exists teams text[];

-- Submissions: own team only (admins bypass). name = any(NULL) fails closed.
drop policy if exists "polar_entries: read" on public.polar_push_entries;
create policy "polar_entries: read" on public.polar_push_entries for select to authenticated
using (
  public.polar_is_admin()
  or exists (
    select 1 from public.staff s
    join public.polar_push_teams t on t.id = polar_push_entries.team_id
    where s.auth_user_id = auth.uid()
      and t.name = any(coalesce(s.teams, '{}'::text[]))
  )
);

-- Submit: authenticated ACTIVE staff only (restores the guard open_submit dropped).
drop policy if exists "polar_entries: submit" on public.polar_push_entries;
create policy "polar_entries: submit" on public.polar_push_entries for insert to authenticated
with check (
  public.polar_is_admin()
  or (status = 'pending' and voided = false
      and exists (select 1 from public.staff s
                  where s.auth_user_id = auth.uid() and coalesce(s.active, true)))
);

-- Mandate upload: authenticated active staff only.
drop policy if exists "polar mandates: upload" on storage.objects;
create policy "polar mandates: upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'polar-mandates'
  and exists (select 1 from public.staff s
              where s.auth_user_id = auth.uid() and coalesce(s.active, true))
);

-- Teams list: authenticated only (drop the anon read added when the site was public).
drop policy if exists "polar_teams: read" on public.polar_push_teams;
create policy "polar_teams: read" on public.polar_push_teams for select to authenticated using (true);

-- Revoke leftover anon read on the public views (login now required).
revoke select on public.polar_push_standings  from anon;
revoke select on public.polar_push_otps_public from anon;
