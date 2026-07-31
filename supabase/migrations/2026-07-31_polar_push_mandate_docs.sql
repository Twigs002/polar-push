-- Operation Polar Push - signed mandate documents.
-- =================================================================
-- Every mandate submitted through the portal must attach the signed mandate
-- document. Files live in a private Storage bucket; the entry keeps the path.

alter table public.polar_push_entries
  add column if not exists document_path text,
  add column if not exists document_name text;

-- Private bucket for the signed mandate files.
insert into storage.buckets (id, name, public)
values ('polar-mandates', 'polar-mandates', false)
on conflict (id) do nothing;

-- Upload: any active staff (a broker) may upload into this bucket.
drop policy if exists "polar mandates: upload" on storage.objects;
create policy "polar mandates: upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'polar-mandates'
    and exists (
      select 1 from public.staff s
      where s.auth_user_id = auth.uid() and coalesce(s.active, true)
    )
  );

-- Read: any signed-in staff can fetch a signed URL (admins verify from it;
-- brokers can re-check their own upload).
drop policy if exists "polar mandates: read" on storage.objects;
create policy "polar mandates: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'polar-mandates');
