-- Operation Polar Push - scope mandate-document READS to admins + owning team.
-- =================================================================
-- Applied live via the SQL editor; recorded here for repo/prod parity.
--
-- Bug (audit H1): the 2026-08-01 lockdown team-scoped raw ENTRY reads but left
-- the Storage read policy from 2026-07-31_polar_push_mandate_docs.sql wide open
--   using (bucket_id = 'polar-mandates')
-- so ANY logged-in staffer could list/fetch EVERY team's signed mandate PDFs
-- (client names, addresses, deal values), defeating the entry-level scoping.
--
-- Fix: align the document read policy with the entry read policy. A signed URL
-- may be created only by an admin (who verifies), the broker who uploaded the
-- file, or a member of the team the mandate's entry belongs to.

drop policy if exists "polar mandates: read" on storage.objects;
create policy "polar mandates: read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'polar-mandates'
    and (
      public.polar_is_admin()                       -- admins verify from the doc
      or owner = auth.uid()                          -- the broker who uploaded it
      or exists (                                    -- a member of the entry's team
        select 1
          from public.polar_push_entries e
          join public.polar_push_teams   t on t.id = e.team_id
          join public.staff              s on s.auth_user_id = auth.uid()
         where e.document_path = storage.objects.name
           and t.name = any(coalesce(s.teams, '{}'::text[]))
      )
    )
  );
