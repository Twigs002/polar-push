-- Operation Polar Push - OTP sheet source + idempotent sync key.
-- =================================================================
-- OTP sales are synced from the "Polar project" Google Sheet by a GitHub
-- Action. Each row carries source='sheet' and its refNumber in `reference`.
-- A unique constraint on `reference` lets the sync upsert (re-run safe) and
-- gives admins the front-office ref to check the deal against.

alter table public.polar_push_entries
  add column if not exists source text not null default 'portal';

-- Property address for mandate submissions (used to label the saved document).
alter table public.polar_push_entries
  add column if not exists property_address text;

-- Portal submissions leave reference NULL (Postgres allows many NULLs under a
-- unique constraint); sheet OTPs carry a distinct refNumber, so this is the
-- upsert conflict target for the sync.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'polar_push_entries_reference_key'
  ) then
    alter table public.polar_push_entries
      add constraint polar_push_entries_reference_key unique (reference);
  end if;
end $$;
