# Operation Polar Push ⚡❄️

Team competition scoreboard for Quay 1 Realty. An 8-week, team-based drive
(**Sat 1 Aug → 30 Sep 2026**) where every signed mandate and sale earns points.
Winning team takes a fully paid weekend away worth R15 000.

```
┌──────────────────────────────────────────────────────────────┐
│  Twigs002/polar-push  →  twigs002.github.io/polar-push/       │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │  static HTML/CSS/JS (no build step)
                          │
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                       │
│   • Sign in (Supabase Auth — clock-in username + PIN)          │
│   • Leaderboard: live team standings (verified deals only)     │
│   • Submit a deal: any broker logs a mandate / sale → pending  │
│   • Scoring: rules table + live points calculator              │
│   • Admin (super/admin): verify submissions, void, manage teams│
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │  HTTPS + JWT (RLS on every table)
                          │
┌──────────────────────────────────────────────────────────────┐
│  Supabase (dqszbqiimbfvmmnpgpsb — shared with quay-clock)      │
│   staff                ← existing auth + roles                 │
│   polar_push_teams     ← competing teams                       │
│   polar_push_entries   ← one row per mandate/sale (verified)   │
│   polar_push_standings ← view: verified, non-voided totals     │
└──────────────────────────────────────────────────────────────┘
```

## Scoring

Points step up one bracket every **R5 million** of deal value
(`bracket = floor(value / 5m) + 1`), multiplied by a base per deal type:

| Deal type                        | Base | Under R5m | R5–10m | R10–15m | R15m+ |
|----------------------------------|------|-----------|--------|---------|-------|
| Sole mandate                     | 2    | 2         | 4      | 6       | 8 (+2/R5m) |
| Dual mandate / Signed open       | 1    | 1         | 2      | 3       | 4 (+1/R5m) |
| Sale (OTP) / Lease               | 4    | 4         | 8      | 12      | 16 (+4/R5m) |

The formula lives in one place on the client (`points.js`) and is enforced
authoritatively in Postgres via a `GENERATED` column, so a team's score can
never drift from what the client shows.

## Verification workflow

Deals only count once **verified**:

1. A broker logs a deal on **Submit a deal** → it lands as `pending`.
2. An admin (Diego) reviews it under **Admin → Pending verification** and either
   **verifies** it (now counts toward standings) or **rejects** it.
3. A verified deal that later falls through can be **voided** (points removed,
   row kept for audit).

Only `status = 'verified' AND NOT voided` entries score points. RLS enforces:
any active staff may submit a `pending` deal; only super/admin may verify,
void, delete, or manage teams.

## Roles

| Who              | Can do                                              |
|------------------|-----------------------------------------------------|
| Any active staff | View leaderboard + scoring; submit their own deals  |
| super / admin    | All of the above + verify/reject, void, manage teams |

Roles come from the shared `staff` table (`is_super` / `is_admin`), same as
`quay-clock` and `quay-leads`.

## Setup

1. **Run the migration** against the Supabase project:
   `supabase/migrations/2026-07-31_polar_push.sql`
   (creates the tables, the `points` generated column, the standings view, and RLS).
2. **Seed the teams** — either via the Admin tab in-app, or uncomment the seed
   block at the bottom of the migration.
3. **GitHub Pages** — served from the repo root on the default branch.

No secrets in the repo: the Supabase URL + anon key are public by design;
all access is gated by Postgres RLS.

## Files

| File                 | Role                                             |
|----------------------|--------------------------------------------------|
| `index.html`         | Shell + login + tab nav                          |
| `config.js`          | Supabase config + competition dates/prize        |
| `points.js`          | Scoring engine (mirrors the DB generated column) |
| `data.js`            | Supabase auth + teams/entries CRUD               |
| `views/leaderboard.js` | Standings + podium + competition clock         |
| `views/submit.js`    | Broker submission form + "my submissions"        |
| `views/scoring.js`   | Rules table + live calculator                    |
| `views/admin.js`     | Verify queue, void, team management              |
| `app.js`             | Auth bootstrap + hash router + toast             |
| `styles.css`         | Quay 1 branded styling                           |
