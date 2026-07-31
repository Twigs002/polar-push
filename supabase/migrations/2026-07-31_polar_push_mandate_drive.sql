-- Operation Polar Push - track which mandate docs have been copied to Drive.
-- =================================================================
-- The Drive sync (GitHub Action) copies each mandate document from the
-- Supabase Storage bucket into a per-team Drive subfolder and records the
-- resulting Drive file id here so it is never re-uploaded.

alter table public.polar_push_entries
  add column if not exists drive_file_id text;
