-- Operation Polar Push - show rentals alongside sales on the tracking tab.
-- =================================================================
-- The public tracking view previously exposed only OTP sales. Broaden it to
-- also include verified leases (rentals) and expose deal_type so the UI can
-- label each row Sale / Rental. Points already reflect the lease value-doubling
-- (that lives in the generated `points` column, untouched here).
--
-- A view column can't be renamed/reordered via CREATE OR REPLACE, so to insert
-- deal_type cleanly we drop and recreate the (leaf) view, then re-grant.

begin;

drop view if exists public.polar_push_otps_public;

create view public.polar_push_otps_public as
  select
    t.name        as team,
    e.deal_type   as deal_type,
    e.signed_date as acceptance_date,
    e.value_rand  as amount,
    e.points      as points,
    e.created_at  as synced_at
  from public.polar_push_entries e
  join public.polar_push_teams t on t.id = e.team_id
  where e.deal_type in ('otp', 'lease')
    and e.status = 'verified'
    and not e.voided;

grant select on public.polar_push_otps_public to anon, authenticated;

commit;
