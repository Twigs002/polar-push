-- Operation Polar Push - leases score on DOUBLE their value.
-- =================================================================
-- A lease (rental) works the same as a sale (base 4 per R5m bracket) but its
-- value counts double when working out the bracket:
--     lease points = 4 × (floor( (2 × value_rand) / 5m ) + 1)
-- Sales and mandates are unchanged (multiplier 1).
--
-- `points` is a STORED generated column, so its expression can't be altered in
-- place - it must be dropped and re-added. Two views read e.points
-- (polar_push_standings, polar_push_otps_public), so drop them first and
-- recreate them verbatim afterwards (with their grants).

begin;

drop view if exists public.polar_push_otps_public;
drop view if exists public.polar_push_standings;

alter table public.polar_push_entries drop column if exists points;

alter table public.polar_push_entries
  add column points integer generated always as (
    (case deal_type
       when 'sole'  then 2
       when 'otp'   then 4
       when 'lease' then 4
       else 1                       -- dual, open
     end)
    * ((floor(
         (value_rand * (case when deal_type = 'lease' then 2 else 1 end)) / 5000000
       ))::int + 1)
  ) stored;

-- Recreate: team standings (with mandate/sale count + points breakdown).
create or replace view public.polar_push_standings as
  select
    t.id                as team_id,
    t.name              as team,
    t.active,
    t.sort_order,
    coalesce(sum(case when e.status = 'verified' and not e.voided then e.points else 0 end), 0)::int as total_points,
    count(e.id) filter (where e.status = 'verified' and not e.voided)                            as entry_count,
    count(e.id) filter (where e.status = 'verified' and not e.voided and e.deal_type in ('sole','dual','open')) as mandate_count,
    count(e.id) filter (where e.status = 'verified' and not e.voided and e.deal_type in ('otp','lease'))        as sale_count,
    count(e.id) filter (where e.status = 'pending')                                              as pending_count,
    coalesce(sum(case when e.status = 'verified' and not e.voided and e.deal_type in ('sole','dual','open') then e.points else 0 end), 0)::int as mandate_points,
    coalesce(sum(case when e.status = 'verified' and not e.voided and e.deal_type in ('otp','lease')        then e.points else 0 end), 0)::int as sale_points
  from public.polar_push_teams t
  left join public.polar_push_entries e on e.team_id = t.id
  group by t.id, t.name, t.active, t.sort_order;

grant select on public.polar_push_standings to anon, authenticated;

-- Recreate: public OTP tracking (team, acceptance date, amount, points).
create or replace view public.polar_push_otps_public as
  select
    t.name        as team,
    e.signed_date as acceptance_date,
    e.value_rand  as amount,
    e.points      as points,
    e.created_at  as synced_at
  from public.polar_push_entries e
  join public.polar_push_teams t on t.id = e.team_id
  where e.deal_type = 'otp' and e.status = 'verified' and not e.voided;

grant select on public.polar_push_otps_public to anon, authenticated;

commit;
