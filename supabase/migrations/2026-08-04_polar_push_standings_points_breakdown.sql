-- Operation Polar Push - add mandate/sale POINTS breakdown to the standings view.
-- =================================================================
-- Applied live via the SQL editor; recorded here for repo/prod parity.
--
-- The standings view already exposes mandate_count / sale_count (deal counts).
-- The screenshot "Board" page also wants the POINTS split, so append
-- mandate_points and sale_points. Additive columns only - existing consumers
-- (leaderboard, admin) are unaffected, and create-or-replace keeps the grants.

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
