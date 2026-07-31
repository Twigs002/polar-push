-- Operation Polar Push - public (no-PIN) read of standings + OTP tracking.
-- =================================================================
-- The leaderboard and OTP tracking are viewable without signing in. We expose
-- ONLY aggregates / limited columns via views (owned by postgres, so they
-- bypass RLS on the base tables). Raw polar_push_entries (values, addresses,
-- submitter names, document paths) stays PIN-gated - anon never reads it.

-- Leaderboard: aggregate team standings.
grant select on public.polar_push_standings to anon, authenticated;

-- OTP tracking: team, acceptance date, amount, points only. Verified OTPs.
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
