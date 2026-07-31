-- Operation Polar Push - 8-week team competition scoreboard.
-- =================================================================
-- Two tables:
--   polar_push_teams   - the competing teams (drives the standings + dropdown)
--   polar_push_entries - one row per verified mandate / sale
--
-- Points are computed authoritatively by a GENERATED column so the score
-- can never drift from the client. The client (points.js) mirrors the same
-- formula for its live preview only.
--
-- Reads: any active staff (the whole company can watch the standings).
-- Writes: super/admin only (Diego tracks + posts results). RLS enforces this.

-- Helper: is the current auth user an active super/admin? -----------------
create or replace function public.polar_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and coalesce(s.active, true)
      and (coalesce(s.is_super, false) or coalesce(s.is_admin, false))
  );
$$;

-- Teams -------------------------------------------------------------------
create table if not exists public.polar_push_teams (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- Entries -----------------------------------------------------------------
create table if not exists public.polar_push_entries (
  id            uuid primary key default gen_random_uuid(),
  team_id       bigint not null references public.polar_push_teams(id) on delete restrict,
  deal_type     text not null check (deal_type in ('sole','dual','open','otp','lease')),
  value_rand    numeric not null check (value_rand >= 0),
  -- Authoritative score. base(deal_type) × bracket, bracket = floor(v/5m)+1.
  points        integer generated always as (
                  (case deal_type
                     when 'sole'  then 2
                     when 'otp'   then 4
                     when 'lease' then 4
                     else 1                       -- dual, open
                   end)
                  * ((floor(value_rand / 5000000))::int + 1)
                ) stored,
  -- Verification workflow. Brokers submit as 'pending'; an admin (Diego)
  -- verifies → 'verified' (counts) or rejects → 'rejected'. Only verified,
  -- non-voided entries score points.
  status        text not null default 'pending' check (status in ('pending','verified','rejected')),
  agent_name    text,                              -- who earned it (optional)
  reference     text,                              -- deal ref / property (optional)
  signed_date   date,                              -- when signed (optional)
  voided        boolean not null default false,    -- verified deal later fell through → 0 pts
  void_reason   text,
  reject_reason text,                              -- why a submission was rejected
  notes         text,
  submitted_by      text,                          -- staff.id of the broker who submitted
  submitted_by_name text,
  verified_by       text,                          -- staff.id of the admin who verified
  verified_by_name  text,
  verified_at       timestamptz,
  created_by    text,                              -- staff.id (admin direct-adds)
  created_by_name text,
  created_at    timestamptz not null default now()
);

create index if not exists polar_push_entries_team_idx on public.polar_push_entries (team_id);

-- Standings view: live totals per team. Only VERIFIED, non-voided deals count.
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
    count(e.id) filter (where e.status = 'pending')                                              as pending_count
  from public.polar_push_teams t
  left join public.polar_push_entries e on e.team_id = t.id
  group by t.id, t.name, t.active, t.sort_order;

-- RLS ---------------------------------------------------------------------
alter table public.polar_push_teams   enable row level security;
alter table public.polar_push_entries enable row level security;

-- Read: any signed-in staff can view teams + entries (the standings screen).
drop policy if exists "polar_teams: read" on public.polar_push_teams;
create policy "polar_teams: read"
  on public.polar_push_teams for select to authenticated using (true);

drop policy if exists "polar_entries: read" on public.polar_push_entries;
create policy "polar_entries: read"
  on public.polar_push_entries for select to authenticated using (true);

-- Submit: any active staff (a broker) may INSERT a new deal, but only as a
-- 'pending', non-voided submission. Admins may insert anything (incl. direct
-- 'verified' entries). Verifying / editing / deleting is admin-only below.
drop policy if exists "polar_entries: submit" on public.polar_push_entries;
create policy "polar_entries: submit"
  on public.polar_push_entries for insert to authenticated
  with check (
    public.polar_is_admin()
    or (
      status = 'pending' and voided = false
      and exists (
        select 1 from public.staff s
        where s.auth_user_id = auth.uid() and coalesce(s.active, true)
      )
    )
  );

drop policy if exists "polar_entries: admin update" on public.polar_push_entries;
create policy "polar_entries: admin update"
  on public.polar_push_entries for update to authenticated
  using (public.polar_is_admin()) with check (public.polar_is_admin());

drop policy if exists "polar_entries: admin delete" on public.polar_push_entries;
create policy "polar_entries: admin delete"
  on public.polar_push_entries for delete to authenticated
  using (public.polar_is_admin());

-- Teams: super/admin only for all writes.
drop policy if exists "polar_teams: admin write" on public.polar_push_teams;
create policy "polar_teams: admin write"
  on public.polar_push_teams for all to authenticated
  using (public.polar_is_admin()) with check (public.polar_is_admin());

-- Seed the competing teams here once the roster is confirmed, e.g.:
--   insert into public.polar_push_teams (name, sort_order) values
--     ('Team A', 1), ('Team B', 2) on conflict (name) do nothing;
