# SBL 2026 — Tournament Tracker
## Product Requirements Document (PRD)

**Document version:** 1.0
**Source of truth for fixtures:** `SBL_2026_Fixtures__4_.xlsx` (committed to repo at `/data/fixtures.xlsx`)
**Target stack:** Next.js 14+ (App Router) · TypeScript · PostgreSQL · shadcn/ui · Tailwind
**Audience:** Engineering implementer (Claude Code)

---

## 1. Purpose & Scope

### 1.1 Problem
The Sysfore Badminton League 2026 (SBL 2026) is a single-day corporate badminton tournament with **44 teams**, **88 players**, **6 parallel courts**, and **~95 matches** (82 group-stage + ~13 knockout) scheduled across 14 group-stage time slots and 4 knockout rounds. The current fixtures live in an Excel workbook. On match day, multiple volunteer scorers stationed at different courts need to record live scores, and the tournament director (TD) needs near-real-time visibility into standings, court status, and bracket progression.

### 1.2 Solution
A Next.js web application backed by PostgreSQL that:
1. Imports the Excel fixtures as the seed of teams, groups, and pre-scheduled matches.
2. Lets multiple **scorers** authenticate, claim a court, and enter live scores for matches assigned to that court.
3. Automatically computes group standings (with tie-breakers) and **auto-populates the knockout bracket** when group-stage matches are complete.
4. Provides a public read-only **spectator view** for live standings, court status, and brackets.
5. Provides an **admin/TD view** for overrides, walkovers, manual seeding, and audit.

### 1.3 In scope (v1)
- Excel-driven seed import (one-shot at deploy + idempotent re-runs)
- Match score entry (group stage + knockouts)
- Auto-computed standings & tie-breakers
- Auto-populated knockout brackets (QF → SF → Final per category)
- Multi-scorer auth with court-level assignment
- Public live spectator view (read-only)
- Admin overrides (walkover, score correction, manual qualifier override)
- Match status lifecycle: `scheduled → live → completed` (+ `walkover`, `void`)
- Real-time UI updates (via Supabase Realtime OR polling; see §10)

### 1.4 Out of scope (v1, future)
- Player registration / self-service signup
- Photo uploads, social sharing
- Bookings, payments, ticketing
- Multi-day tournament support
- Mobile native apps (web is responsive-first)
- Live streaming integration

---

## 2. Tournament Context (Source: Excel)

### 2.1 Categories & format
| Category | Code | Teams | Group structure | Group format | Knockout path |
|---|---|---|---|---|---|
| Men's Beginner | `MB` | 22 | 4 groups: A(5), B(5), C(6), D(6) | 1 game to 15 (straight, no cap) | Top 2 each = 8 → QF → SF → Final |
| Men's Intermediate | `MI` | 12 | 4 groups of 3 (A, B, C, D) | 1 game to 21 (straight, cap 30) | Top 2 each = 8 → QF → SF → Final |
| Women's | `W`  | 10 | 2 groups of 5 (A, B) | 1 game to 15 (straight, no cap) | Top 2 each = 4 → SF → Final |

**Knockouts (all categories):** best of 3 games to 21, rally scoring, cap 30. 60-sec break at 11. 2-min interval between games.

### 2.2 Day-of schedule
- **08:30** — Player check-in
- **09:00** — Captain's briefing, group stage begins
- **09:00 – 13:40** — Group stage (14 slots × 20 min each, 6 courts in parallel)
- **13:40 – 14:10** — Lunch
- **14:10 – 14:45** — KO Round 1 (4 MB QF + 2 MI QF)
- **14:50 – 15:25** — KO Round 2 (2 MI QF + 2 W SF + 2 MB SF)
- **15:30 – 16:05** — KO Round 3 (2 MI SF + Women's Final + Men's Beginner Final)
- **16:10 – 16:45** — KO Round 4 (Men's Intermediate Final)
- **16:45 – 17:00** — Prize ceremony

### 2.3 Match counts (validated against Excel)
- Group stage: **82 matches** (MB: 50, W: 20, MI: 12)
- Knockouts: 4 MB QF + 4 MI QF + 2 W SF + 2 MB SF + 2 MI SF + 1 W F + 1 MB F + 1 MI F = **17 KO matches**
- **Total: 99 matches**

### 2.4 Tie-break rules (group standings)
Order of precedence — apply only when teams are tied on the previous metric:
1. **Points** (2 for win, 0 for loss). _Ties broken by:_
2. **Head-to-head** result (only when exactly 2 teams tied; if 3+ teams tied skip to step 3)
3. **Set difference** (sets_won − sets_lost). For group stage formats which are single-game, treat games as sets.
4. **Points difference** (points_scored − points_conceded across all matches in the group)
5. **Toss** (manual override by TD via admin UI)

---

## 3. Personas & Roles

| Role | Description | Key permissions |
|---|---|---|
| **Spectator** (anonymous) | Players, captains, audience | Read-only: live scores, standings, brackets, schedule |
| **Scorer** | Volunteer at a specific court | Update score & status of matches scheduled for their assigned court(s); cannot edit completed matches |
| **Admin / Tournament Director** | Tournament organizer | All scorer permissions + score corrections on completed matches, walkovers, manual qualifier overrides, manage scorer accounts, lock/unlock standings, trigger bracket generation, view audit log |

There are no individual player logins in v1.

---

## 4. Functional Requirements

### 4.1 Public spectator view (no auth)
- **F-PUB-1** Home dashboard: current time slot, list of matches currently `live` per court, "next up" matches, headline updates (latest completions).
- **F-PUB-2** Schedule view: filterable by category, group, court, round; shows scheduled time, current status, score (if live/done).
- **F-PUB-3** Group standings: per category, per group — table of P/W/L/Pts, set diff, points diff, sorted with tie-breaks applied; visually flag the top 2 (qualifiers).
- **F-PUB-4** Bracket view: per category — QF/SF/Final cards with team names auto-filling once seeded; show winner highlight when match completes.
- **F-PUB-5** Team detail page: team name, players, company, all scheduled & past matches with results.
- **F-PUB-6** Court view: pick a court → see today's full slot list for that court with status.
- **F-PUB-7** All views auto-refresh every ≤10 s OR receive realtime updates (see §10).

### 4.2 Scorer view (auth required)
- **F-SCO-1** Login via username + PIN (4–6 digit). PIN is hashed at rest; configurable lockout after 5 wrong attempts.
- **F-SCO-2** After login, scorer lands on **"My Court(s)"** page showing their assigned courts and the chronologically next match (or current live match) per assigned court.
- **F-SCO-3** On a match detail page the scorer can:
  - Mark match `live` (timestamp `started_at`)
  - Increment / decrement points for either team (large tap targets — used on phone/tablet courtside)
  - For knockout matches, advance to next set after a set ends; UI tracks set-by-set scores
  - Submit final score → status becomes `completed`, `winner_team_id` set, `ended_at` stamped
  - Mark match as **walkover** (selects winning team, opponent forfeits)
- **F-SCO-4** Score validation (client + server enforced):
  - Group MB / W: single game, first to 15, no cap, must lead by 1+ (no two-clear required)
  - Group MI: single game, first to 21, **cap 30** (winner reaches either 21 with ≥2 lead, or 30)
  - KO (all): best of 3, each game first to 21, cap 30; match ends when a team wins 2 games
- **F-SCO-5** A scorer cannot edit a `completed` match — must request admin override.
- **F-SCO-6** A scorer can only edit matches whose `court_id` is in their assigned-courts list.
- **F-SCO-7** Optimistic UI with conflict detection: if a match was modified concurrently (server returns 409), UI prompts to refresh.
- **F-SCO-8** Mobile-first responsive layout (designed for phones held courtside).

### 4.3 Admin / TD view (auth required, role=`admin`)
- **F-ADM-1** Everything a scorer can do, on **any** match regardless of court assignment.
- **F-ADM-2** Edit completed match scores (creates audit log entry).
- **F-ADM-3** Manually set qualifier (winner/runner-up) for a group when standings cannot resolve via tie-breakers (toss outcome). UI clearly labels this as "TD override."
- **F-ADM-4** Trigger / re-trigger knockout bracket generation per category.
- **F-ADM-5** Manage scorer accounts: create, deactivate, reset PIN, assign/unassign courts.
- **F-ADM-6** Pause / resume tournament timer (display-only).
- **F-ADM-7** Audit log view: who changed what when (immutable, append-only).
- **F-ADM-8** Re-import fixtures from Excel (idempotent — see §6.4); admin sees a diff/confirmation before applying.

### 4.4 Match lifecycle
```
scheduled  ──► live  ──► completed
    │                      ▲
    └──► walkover ─────────┘   (admin / scorer can mark walkover from scheduled)
    └──► void   (admin only — match removed from standings)
```
Allowed transitions are enforced server-side. `live → scheduled` is only allowed by admin (e.g., started in error).

---

## 5. Data Model (PostgreSQL DDL)

> All tables use `uuid` primary keys (default `gen_random_uuid()`). Timestamps are `timestamptz`. All FKs use `ON DELETE RESTRICT` unless noted.

```sql
-- Categories: MB, MI, W
CREATE TABLE categories (
  id           text PRIMARY KEY,         -- 'MB' | 'MI' | 'W'
  name         text NOT NULL,            -- "Men's Beginner"
  group_format text NOT NULL,            -- 'single_game_15' | 'single_game_21_cap30'
  ko_format    text NOT NULL DEFAULT 'bo3_21_cap30'
);

-- Groups: MBA, MBB, MBC, MBD, MIA, MIB, MIC, MID, WA, WB
CREATE TABLE groups (
  id          text PRIMARY KEY,          -- 'MBA' etc.
  category_id text NOT NULL REFERENCES categories(id),
  label       text NOT NULL,             -- 'Group A'
  team_count  int  NOT NULL              -- 5 or 6 or 3
);

CREATE TABLE companies (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE             -- 'Sysfore', 'KRAFT', 'ANT PHY'
);

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    text NOT NULL REFERENCES groups(id),
  seed        int  NOT NULL,             -- seed within group (1..N)
  name        text NOT NULL,             -- 'Net Dominators'
  players     text NOT NULL,             -- 'Abhishek Madesh & Balaji P' (free text v1)
  company_id  uuid REFERENCES companies(id),
  UNIQUE (group_id, seed),
  UNIQUE (group_id, name)
);

CREATE TABLE courts (
  id   text PRIMARY KEY,                 -- 'C1'..'C6'
  name text NOT NULL                     -- 'Court 1'
);

-- Matches: covers BOTH group stage and knockouts
CREATE TABLE matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     text NOT NULL REFERENCES categories(id),
  stage           text NOT NULL,                 -- 'group' | 'qf' | 'sf' | 'final'
  group_id        text REFERENCES groups(id),    -- non-null for group stage, null for KO
  round_label     text,                          -- 'R1'..'R5' for group, 'QF1'..'QF4', 'SF1', 'SF2', 'F' for KO
  slot_number     int,                           -- 1..14 for group; null for KO
  scheduled_time  text NOT NULL,                 -- '09:00 - 09:20' (free text — single-day, simple)
  scheduled_start timestamptz,                   -- canonical timestamp when computed
  court_id        text NOT NULL REFERENCES courts(id),
  team_a_id       uuid REFERENCES teams(id),     -- nullable for KO until populated
  team_b_id       uuid REFERENCES teams(id),
  -- For KO matches we track the source slots so brackets auto-fill:
  team_a_source   text,                          -- e.g. 'group_winner:MBA' or 'match_winner:<match_id>'
  team_b_source   text,
  status          text NOT NULL DEFAULT 'scheduled',
                                                  -- 'scheduled'|'live'|'completed'|'walkover'|'void'
  started_at      timestamptz,
  ended_at        timestamptz,
  winner_team_id  uuid REFERENCES teams(id),
  -- Score storage: JSON array of game scores. Group stage = 1 entry; KO = up to 3.
  -- e.g. [{ "a": 21, "b": 17 }, { "a": 18, "b": 21 }, { "a": 21, "b": 19 }]
  games           jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('scheduled','live','completed','walkover','void')),
  CHECK (stage  IN ('group','qf','sf','final'))
);

CREATE INDEX matches_court_time_idx ON matches(court_id, scheduled_start);
CREATE INDEX matches_status_idx     ON matches(status);
CREATE INDEX matches_group_idx      ON matches(group_id) WHERE group_id IS NOT NULL;

-- Scorer accounts
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username     text NOT NULL UNIQUE,
  display_name text NOT NULL,
  pin_hash     text NOT NULL,                  -- bcrypt/argon2
  role         text NOT NULL DEFAULT 'scorer', -- 'scorer' | 'admin'
  is_active    boolean NOT NULL DEFAULT true,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('scorer','admin'))
);

-- Scorer ↔ court assignments (M:N). Admins ignore this table.
CREATE TABLE scorer_courts (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  court_id text NOT NULL REFERENCES courts(id),
  PRIMARY KEY (user_id, court_id)
);

-- Append-only audit log
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  match_id    uuid REFERENCES matches(id),
  action      text NOT NULL,            -- 'score_update', 'status_change', 'override', 'walkover', 'fixture_import', ...
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_match_idx ON audit_log(match_id, created_at DESC);

-- Manual qualifier overrides (TD's toss decisions)
CREATE TABLE group_qualifier_overrides (
  group_id      text PRIMARY KEY REFERENCES groups(id),
  winner_team_id     uuid REFERENCES teams(id),
  runner_up_team_id  uuid REFERENCES teams(id),
  set_by_user_id     uuid REFERENCES users(id),
  set_at        timestamptz NOT NULL DEFAULT now(),
  reason        text
);

-- Materialized standings cache (recomputed after each match) — optional optimization.
-- v1 may compute on-the-fly; switch to this if the standings query becomes hot.
CREATE TABLE group_standings (
  group_id        text NOT NULL REFERENCES groups(id),
  team_id         uuid NOT NULL REFERENCES teams(id),
  played          int NOT NULL DEFAULT 0,
  wins            int NOT NULL DEFAULT 0,
  losses          int NOT NULL DEFAULT 0,
  points          int NOT NULL DEFAULT 0,    -- 2 per win
  sets_won        int NOT NULL DEFAULT 0,
  sets_lost       int NOT NULL DEFAULT 0,
  pts_scored      int NOT NULL DEFAULT 0,
  pts_conceded    int NOT NULL DEFAULT 0,
  rank            int,
  is_qualifier    boolean NOT NULL DEFAULT false,
  qualifier_role  text,                      -- 'winner' | 'runner_up' | null
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, team_id)
);
```

### 5.1 Why JSON for `games`?
A doubles match has at most 3 games of 2 integers each. Trying to model this in normal-form (separate `games` table) adds joins for almost no schema win. JSON keeps reads to a single row and writes atomic.

---

## 6. Excel Import / Seeding

### 6.1 Source file
The Excel file `SBL_2026_Fixtures__4_.xlsx` ships with the repo at `/data/fixtures.xlsx`. It has these relevant sheets:
- `Teams & Groups` — team roster per group with seeds, players, company
- `Group Stage Schedule` — every group-stage match with slot, time, court, group, match-up, round
- `Court Timetable` — same data pivoted by court (used as a sanity check, not a source)
- `Knockouts` — KO bracket scaffolding (QF/SF/F slots with placeholder match-ups)
- `Match Day Brief`, `Cover` — informational, not imported

### 6.2 Importer script
A Node.js CLI script `scripts/import-fixtures.ts` (run via `pnpm tsx scripts/import-fixtures.ts`) using `exceljs` or `xlsx`:

1. **Parse `Teams & Groups`**: build categories, groups, companies, teams (with `seed`).
2. **Parse `Group Stage Schedule`**: for each row create a `match` row with `stage='group'`, `group_id`, `round_label`, `slot_number`, `scheduled_time`, `court_id`, `team_a_id`, `team_b_id` (resolved by team-name lookup within the group).
3. **Generate KO match scaffolding**: don't read from the Excel `Knockouts` sheet — generate deterministically (see §8). Insert `qf`, `sf`, `final` matches per category with `team_a_source` / `team_b_source` populated and team IDs `null`.
4. Write a record to `audit_log` (`action='fixture_import'`).

### 6.3 Court ID mapping
`Court 1` → `C1`, ..., `Court 6` → `C6`.

### 6.4 Idempotency
The importer must be re-runnable without duplicating data:
- Upsert categories, groups, companies, courts by their natural key.
- Upsert teams by `(group_id, seed)`.
- Upsert matches by a deterministic external key. Construct it as:
  - Group: `group:<group_id>:<round_label>:<slot_number>:<court_id>` (e.g. `group:MBA:R1:2:C1`)
  - KO: `ko:<category_id>:<stage>:<round_label>` (e.g. `ko:MB:qf:QF1`)
  Add a column `external_key text UNIQUE` to `matches` for this purpose.
- If a match is already `completed` and the importer would overwrite teams/scores, **abort with diff** — admin must explicitly confirm.

### 6.5 Time parsing (optional v1.1)
The Excel column `scheduled_time` is free-text like `'09:00 - 09:20'`. v1 stores it as-is in `scheduled_time`. v1.1 parses the start half into `scheduled_start` (`timestamptz`) using the tournament date (configurable env var `TOURNAMENT_DATE=2026-XX-XX`).

---

## 7. Standings Computation

### 7.1 Inputs
For a given `group_id`, fetch all `matches` where `group_id = $1` and `status IN ('completed','walkover')`.

### 7.2 Per-team aggregation
For each team, accumulate from each match they played:
- `played += 1`
- If team is `winner_team_id`: `wins += 1`, `points += 2`
- Else: `losses += 1`
- For each game in `games` array:
  - `pts_scored += team's_score_in_that_game`
  - `pts_conceded += opponent's_score_in_that_game`
  - If team's score > opponent's → `sets_won += 1` else `sets_lost += 1`
- For walkovers: count as `wins=1` for the declared winner with `sets_won += 1`, no point totals.

### 7.3 Sort comparator (descending priority)
```
1. points DESC
2. (only when exactly two teams remain tied at this rank)
   head-to-head: did team A beat team B? if yes, A above B.
3. (sets_won - sets_lost) DESC
4. (pts_scored - pts_conceded) DESC
5. fall back to manual override / TD toss
```

### 7.4 Qualifiers
Top 2 teams (by sorted rank) → `is_qualifier = true`, with `qualifier_role` set to `'winner'` and `'runner_up'` respectively. Override table (`group_qualifier_overrides`) takes precedence over computed values.

### 7.5 When to recompute
Recompute the affected group's standings on every match `INSERT`, `UPDATE`, `DELETE` where `group_id IS NOT NULL`. Implement either:
- **(Recommended v1)** Application-level: a `recomputeStandings(groupId)` function called from the API handler in the same transaction as the match update.
- **(Alternative)** Postgres trigger on `matches` that calls a stored procedure.

### 7.6 Stale standings flag
After a match is marked `live`, the group's standings are still valid (no completed result changed). Only mark standings "stale" on completion/correction.

---

## 8. Knockout Bracket Auto-Population

### 8.1 Bracket pairings (deterministic)

**Men's Beginner (MB) — cross-bracket to keep group rivals apart until SF:**
| Match | Team A source | Team B source |
|---|---|---|
| QF1 | MB-A Winner | MB-D Runner-up |
| QF2 | MB-B Winner | MB-C Runner-up |
| QF3 | MB-C Winner | MB-B Runner-up |
| QF4 | MB-D Winner | MB-A Runner-up |
| SF1 | QF1 Winner | QF4 Winner |
| SF2 | QF2 Winner | QF3 Winner |
| F   | SF1 Winner | SF2 Winner |

**Men's Intermediate (MI) — same pairing pattern:**
| Match | Team A source | Team B source |
|---|---|---|
| QF1 | MI-A Winner | MI-D Runner-up |
| QF2 | MI-B Winner | MI-C Runner-up |
| QF3 | MI-C Winner | MI-B Runner-up |
| QF4 | MI-D Winner | MI-A Runner-up |
| SF1 | QF1 Winner | QF4 Winner |
| SF2 | QF2 Winner | QF3 Winner |
| F   | SF1 Winner | SF2 Winner |

**Women's (W):**
| Match | Team A source | Team B source |
|---|---|---|
| SF1 | W-A Winner | W-B Runner-up |
| SF2 | W-B Winner | W-A Runner-up |
| F   | SF1 Winner | SF2 Winner |

### 8.2 Court & time slots for KO (from Excel)
| Category | Stage | Time slot | Court |
|---|---|---|---|
| MB | QF1 | 14:10–14:45 | Court 1 |
| MB | QF2 | 14:10–14:45 | Court 2 |
| MB | QF3 | 14:10–14:45 | Court 3 |
| MB | QF4 | 14:10–14:45 | Court 4 |
| MI | QF1 | 14:10–14:45 | Court 5 |
| MI | QF2 | 14:10–14:45 | Court 6 |
| MI | QF3 | 14:50–15:25 | Court 1 |
| MI | QF4 | 14:50–15:25 | Court 2 |
| W  | SF1 | 14:50–15:25 | Court 3 |
| W  | SF2 | 14:50–15:25 | Court 4 |
| MB | SF1 | 14:50–15:25 | Court 5 |
| MB | SF2 | 14:50–15:25 | Court 6 |
| MI | SF1 | 15:30–16:05 | Court 1 |
| MI | SF2 | 15:30–16:05 | Court 2 |
| W  | F   | 15:30–16:05 | Court 3 |
| MB | F   | 15:30–16:05 | Court 4 |
| MI | F   | 16:10–16:45 | Court 1 |

### 8.3 Population trigger
A KO match's `team_a_id` / `team_b_id` is populated when its source resolves:
- For QFs: triggered when the referenced group's qualifiers are determined (all group matches `completed` AND standings non-ambiguous OR override present).
- For SFs / Final: triggered when the referenced QF/SF match has `status='completed'` and `winner_team_id` set.

Implement as a function `propagateKnockouts(categoryId)` called after every relevant match completion and after standings recompute.

### 8.4 Edge: ambiguous qualification
If standings don't resolve via §7.3 steps 1–4, the bracket cannot auto-populate. The UI shows an **"Awaiting TD decision"** banner on the affected QF cards. Admin uses the override UI (§4.3) to set `winner` / `runner_up`, which then triggers propagation.

---

## 9. API Surface (Next.js App Router)

All routes live under `app/api/`. Auth via `next-auth` (or Lucia / custom JWT — implementer's choice; spec assumes `next-auth` with credentials provider). Server actions are acceptable in lieu of REST routes for mutations.

### 9.1 Public (no auth)
| Method | Path | Description |
|---|---|---|
| GET | `/api/categories` | List categories |
| GET | `/api/groups?category=MB` | Groups in a category |
| GET | `/api/teams?group=MBA` | Teams in a group |
| GET | `/api/standings?group=MBA` | Computed standings for a group |
| GET | `/api/matches?status=live` | Live matches across the tournament |
| GET | `/api/matches?court=C1` | All matches on a court (chronological) |
| GET | `/api/matches/:id` | Single match |
| GET | `/api/bracket?category=MB` | KO bracket for a category |
| GET | `/api/schedule?slot=1` | All matches in a given slot |

### 9.2 Auth
| POST | `/api/auth/login` | `{ username, pin }` → session cookie |
| POST | `/api/auth/logout` | clears session |

### 9.3 Scorer (auth: scorer or admin)
| POST  | `/api/matches/:id/start` | sets status=`live`, stamps `started_at`. Verifies caller is assigned to the match's court. |
| PATCH | `/api/matches/:id/score` | body: `{ games: [{a, b}, ...] }`. Writes incremental score. Validates against category format rules. |
| POST  | `/api/matches/:id/complete` | body: `{ games, winner_team_id }`. Marks completed, recomputes standings, propagates brackets. |
| POST  | `/api/matches/:id/walkover` | body: `{ winner_team_id, reason? }` |

### 9.4 Admin (auth: admin)
| POST  | `/api/admin/matches/:id/correct` | body: `{ games, winner_team_id, reason }` — overrides a completed match |
| POST  | `/api/admin/groups/:id/override` | body: `{ winner_team_id, runner_up_team_id, reason }` |
| POST  | `/api/admin/users` | create scorer |
| PATCH | `/api/admin/users/:id` | update scorer (assign courts, deactivate, reset pin) |
| POST  | `/api/admin/import-fixtures` | re-runs Excel importer; returns diff for confirmation |
| GET   | `/api/admin/audit-log?match=:id` | view audit history |

### 9.5 Validation rules (server-side, every mutation)
- Reject score update if status not in `{ scheduled, live }`
- Reject if caller's role is `scorer` and match's `court_id` not in their `scorer_courts`
- Reject if game score violates the category's format constraints (see §4.2 F-SCO-4)
- Reject if `winner_team_id` is not one of the match's two teams

---

## 10. Real-time Updates

### 10.1 Recommended: Supabase Realtime
Host PostgreSQL on Supabase. Subscribe in the browser to `matches` and `group_standings` table changes. Spectators get pushed updates ≤2s after a scorer presses "complete".

### 10.2 Alternative: SWR polling
If self-hosting Postgres, use SWR (`useSWR`) with `refreshInterval: 5000` on the public list endpoints. Latency 0–5s, which is acceptable for a single-day event.

### 10.3 Decision
Pick one at implementation time. Default to Supabase if no objection — it removes a whole class of plumbing.

---

## 11. UI / Screens

Use shadcn/ui primitives throughout. Tailwind for layout. Mobile-first.

### 11.1 Public routes
- `/` — Live dashboard (currently-live matches + slot status + headline updates)
- `/schedule` — Filterable schedule
- `/standings` — Tabs per category → tabs per group
- `/bracket` — Tabs per category → bracket diagram (use a tree layout — see §11.5)
- `/team/[id]` — Team profile
- `/court/[id]` — Court timeline

### 11.2 Scorer routes
- `/scorer/login` — Username + PIN
- `/scorer` — "My Court(s)" dashboard
- `/scorer/match/[id]` — Score entry screen (large numerals, +/− buttons, set tabs for KO)

### 11.3 Admin routes
- `/admin` — Overview
- `/admin/matches` — All matches table with filters
- `/admin/matches/[id]` — Admin-flavored match editor (history visible)
- `/admin/users` — Scorer management
- `/admin/groups/[id]/override` — TD override panel
- `/admin/audit` — Audit log

### 11.4 Score entry screen — UX requirements
- Two large team cards stacked (top = team A, bottom = team B)
- Within each card: team name, players, **current points displayed in 96pt font**, big +/− buttons
- For KO: a row of 3 set tabs (Set 1 / Set 2 / Set 3) at the top; switching tabs shows that set's score
- Sticky bottom bar: `Status: live` indicator + `Mark Complete` button (disabled until winner is mathematically determined per format rules)
- Confirmation modal on Mark Complete showing final summary
- Undo last point: a single-step "Undo" button (only undoes the most recent point increment within the current set; once `Mark Complete` is pressed, only admin can change)

### 11.5 Bracket visualization
A simple horizontal tree:
```
QF1 ┐
    ├─ SF1 ┐
QF4 ┘      │
           ├─ FINAL
QF2 ┐      │
    ├─ SF2 ┘
QF3 ┘
```
Match cards show team names (or source label like "MB-A Winner" pre-population), score if completed, winner highlighted in primary color. Clickable → match detail.

---

## 12. Non-functional Requirements

- **Performance**: All public list endpoints respond in <300 ms p95 with the full tournament loaded.
- **Concurrency**: Two scorers cannot simultaneously edit the same match — last-write-wins is unacceptable. Use `updated_at` as an `If-Match` token (optimistic concurrency control); server returns `409 Conflict` on mismatch.
- **Reliability**: Match data must survive a browser refresh / scorer device dying. All state lives server-side; the client is a thin renderer.
- **Auditability**: Every mutation by an admin (corrections, overrides) writes to `audit_log` with before/after JSON.
- **Security**:
  - PINs hashed with argon2id (or bcrypt with cost ≥12).
  - Account lockout: 5 wrong PINs → locked for 15 minutes (`locked_until`).
  - Rate limit `/api/auth/login` to 10 req/min per IP.
  - All scorer/admin routes require `auth()` check on the server; no relying on client-side route guards.
  - CSRF protection on all mutating endpoints.
- **Accessibility**: All interactive elements have visible focus rings; score entry buttons are ≥48px tap target; standings tables use proper `<th scope="col">` semantics.
- **Responsive**: Score-entry screen fully usable on a 375×667 viewport.
- **Error handling**: Network failures during score submission show a clear "retry" affordance and queue the request locally for one retry.

---

## 13. Tech Stack & Project Layout

```
sbl-2026-tracker/
├── app/                          # Next.js App Router
│   ├── (public)/                 # spectator routes
│   ├── (scorer)/scorer/          # scorer routes
│   ├── (admin)/admin/            # admin routes
│   └── api/                      # route handlers
├── components/
│   ├── ui/                       # shadcn primitives (already templated)
│   ├── bracket/
│   ├── score-entry/
│   └── standings/
├── lib/
│   ├── db.ts                     # Postgres client (drizzle / prisma — pick one)
│   ├── auth.ts                   # next-auth config
│   ├── standings.ts              # computeStandings(), tie-breaker logic
│   ├── brackets.ts               # propagateKnockouts(), pairing tables
│   ├── format-rules.ts           # validateGameScore(category, games)
│   └── realtime.ts               # Supabase client OR polling helpers
├── data/
│   └── fixtures.xlsx             # source of truth, committed
├── scripts/
│   └── import-fixtures.ts        # CLI Excel importer
├── drizzle/                      # migrations (or prisma/migrations)
└── tests/
    ├── unit/standings.test.ts
    ├── unit/brackets.test.ts
    └── e2e/scorer-flow.spec.ts
```

**Recommended specific choices:**
- ORM: **Drizzle** (lighter, type-safe, plays well with edge runtimes). Prisma is acceptable.
- Auth: **next-auth** (credentials provider) or Lucia.
- Excel parsing: **`exceljs`** (richer than `xlsx` for our needs).
- Forms: shadcn's react-hook-form + zod
- Validation: **zod** schemas shared between client and server
- Tests: **Vitest** for unit, **Playwright** for e2e
- Package manager: **pnpm**

---

## 14. Edge Cases & Error Handling

| Scenario | Expected behavior |
|---|---|
| Two scorers open the same match and both press +1 | Server uses `updated_at` optimistic lock; second request gets 409, UI auto-refreshes and replays the increment. |
| Scorer marks complete with invalid score (e.g. 18-15 in a to-21 match) | Server rejects with 400; UI shows inline error. |
| Group has 3-way tie with identical set & point diffs | Standings flagged ambiguous; KO bracket for affected slots awaits TD override. |
| A team no-shows | Scorer/admin marks match `walkover`, picks present team as winner; standings count it as a win, set diff +1, no point totals. |
| Admin re-imports fixtures after matches have been played | Importer detects existing completed matches; presents diff; aborts unless admin confirms with "force" flag (and audit-logs it). |
| Scorer's device loses internet mid-match | Score state for that match is server-side; on reconnect, UI refetches. Local +/- presses since last successful sync are queued (single-flight). |
| KO match populated, then group standing corrected by admin → different qualifier | If KO match is `scheduled`, repopulate. If `live` or `completed`, admin must explicitly void/reset. |
| Power outage / app restart | All state in Postgres; nothing in-memory matters. Sessions persist via cookies. |

---

## 15. Acceptance Criteria (v1)

### 15.1 Seed
- [ ] Running `pnpm tsx scripts/import-fixtures.ts` against an empty DB creates 3 categories, 10 groups, 44 teams, 6 courts, 82 group-stage matches, 17 KO match scaffolds.
- [ ] Re-running the importer is idempotent: zero duplicates, standings unchanged.

### 15.2 Scoring
- [ ] A logged-in scorer assigned to Court 1 can start, score, and complete the first scheduled MBA match. The match transitions `scheduled → live → completed`.
- [ ] After completing all 10 group A matches in MB, the standings table shows `played=4` for each team and tie-breakers are applied per §7.3.
- [ ] A scorer assigned only to Court 1 receives 403 trying to update a Court 2 match.

### 15.3 Brackets
- [ ] When MB-A and MB-D groups are both fully completed, MB QF1 and MB QF4 have populated team IDs that match the standings winners/runners-up.
- [ ] Completing all MB QFs populates MB SF1 and MB SF2 correctly per §8.1.

### 15.4 Realtime
- [ ] A spectator with the standings page open sees a refreshed score within 10 seconds of a scorer pressing "Mark Complete".

### 15.5 Admin
- [ ] An admin can correct a completed match's score; the change appears in the audit log with before/after JSON.
- [ ] An admin can set a manual qualifier override; the bracket repopulates accordingly.

### 15.6 Auth
- [ ] PINs are stored as argon2 hashes, not plaintext.
- [ ] 5 failed PIN attempts locks the account for 15 minutes.

---

## 16. Implementation Phases (suggested)

**Phase 0 — Foundations (½ day)**
- Bootstrap Next.js + Tailwind + shadcn + Drizzle + Postgres
- Set up `next-auth` skeleton
- Migrations for all tables in §5

**Phase 1 — Seed + Read (1 day)**
- Build `import-fixtures.ts`
- Public routes: `/`, `/schedule`, `/standings`, `/team/[id]`, `/court/[id]` (read-only, with computed standings showing all zeros initially)
- Bracket page with placeholder labels

**Phase 2 — Scoring (1 day)**
- Auth (login, session)
- `/scorer` dashboard
- `/scorer/match/[id]` score entry screen
- Mutation endpoints for start/score/complete/walkover
- Standings recomputation
- Format-rule validation

**Phase 3 — Brackets + Realtime (½ day)**
- `propagateKnockouts` logic
- Realtime subscription wiring (Supabase) OR SWR polling

**Phase 4 — Admin (½ day)**
- Admin overrides
- Score corrections + audit log view
- Scorer account management

**Phase 5 — Polish + tests (½ day)**
- Unit tests for `standings.ts` and `brackets.ts` (highest-value: tie-break edge cases and bracket propagation)
- One Playwright e2e: scorer logs in, completes a match, spectator sees the update
- Empty/error states across all screens

**Total: ~4 working days for one engineer.**

---

## 17. Open Questions for the Tournament Director

These decisions should be confirmed before deploy. Sensible defaults are baked into the spec; flag them on the admin onboarding page.

1. **Tournament date** — Excel doesn't carry a date. Default: configure via `TOURNAMENT_DATE` env var.
2. **Walkover scoring convention** — Spec assumes WO = 1 win, 1 set won, 0 points scored/conceded. Confirm.
3. **Head-to-head with 3+ tied teams** — Spec skips H2H and goes straight to set diff (per common practice). Confirm.
4. **Cap on group MB / W** — Excel cover sheet says "no cap unless announced". Spec treats first-to-15-by-1 as the rule with no cap. Confirm.
5. **Knockout knock-up** — 5-min knock-up scheduled into the slot. App does not need to track it.

---

## Appendix A — Pairing constants (copy into `lib/brackets.ts`)

```ts
export const KO_PAIRINGS = {
  MB: {
    qf: [
      { code: 'QF1', a: 'group_winner:MBA',  b: 'group_runner:MBD' },
      { code: 'QF2', a: 'group_winner:MBB',  b: 'group_runner:MBC' },
      { code: 'QF3', a: 'group_winner:MBC',  b: 'group_runner:MBB' },
      { code: 'QF4', a: 'group_winner:MBD',  b: 'group_runner:MBA' },
    ],
    sf: [
      { code: 'SF1', a: 'match_winner:QF1', b: 'match_winner:QF4' },
      { code: 'SF2', a: 'match_winner:QF2', b: 'match_winner:QF3' },
    ],
    final: { code: 'F', a: 'match_winner:SF1', b: 'match_winner:SF2' },
  },
  MI: {
    qf: [
      { code: 'QF1', a: 'group_winner:MIA',  b: 'group_runner:MID' },
      { code: 'QF2', a: 'group_winner:MIB',  b: 'group_runner:MIC' },
      { code: 'QF3', a: 'group_winner:MIC',  b: 'group_runner:MIB' },
      { code: 'QF4', a: 'group_winner:MID',  b: 'group_runner:MIA' },
    ],
    sf: [
      { code: 'SF1', a: 'match_winner:QF1', b: 'match_winner:QF4' },
      { code: 'SF2', a: 'match_winner:QF2', b: 'match_winner:QF3' },
    ],
    final: { code: 'F', a: 'match_winner:SF1', b: 'match_winner:SF2' },
  },
  W: {
    sf: [
      { code: 'SF1', a: 'group_winner:WA',  b: 'group_runner:WB' },
      { code: 'SF2', a: 'group_winner:WB',  b: 'group_runner:WA' },
    ],
    final: { code: 'F', a: 'match_winner:SF1', b: 'match_winner:SF2' },
  },
} as const;
```

## Appendix B — Format-rule validators (copy into `lib/format-rules.ts`)

```ts
type Game = { a: number; b: number };

export function validateGroupGame(category: 'MB'|'MI'|'W', g: Game): { ok: boolean; reason?: string } {
  const target = category === 'MI' ? 21 : 15;
  const cap = category === 'MI' ? 30 : null;
  const max = Math.max(g.a, g.b);
  const min = Math.min(g.a, g.b);
  // not yet finished
  if (max < target) return { ok: false, reason: 'not_finished' };
  // cap reached
  if (cap && max === cap && min === cap - 1) return { ok: true };
  // standard finish: reach target with ≥2 lead (or ≥1 if no two-clear required)
  // Spec defines MB/W as "straight, no cap" → ≥1 lead. MI uses two-clear up to cap 30.
  if (category === 'MI') {
    if (max >= target && (max - min) >= 2) return { ok: true };
    if (cap && max === cap) return { ok: true };
    return { ok: false, reason: 'need_two_lead' };
  }
  // MB / W
  if (max >= target && max > min) return { ok: true };
  return { ok: false, reason: 'invalid' };
}

export function validateKnockoutMatch(games: Game[]): { ok: boolean; winner?: 'a'|'b' } {
  if (games.length < 2 || games.length > 3) return { ok: false };
  let aWins = 0, bWins = 0;
  for (const g of games) {
    const max = Math.max(g.a, g.b), min = Math.min(g.a, g.b);
    const valid = (max >= 21 && (max - min) >= 2) || (max === 30 && min === 29);
    if (!valid) return { ok: false };
    if (g.a > g.b) aWins++; else bWins++;
  }
  if (aWins === 2 && bWins < 2) return { ok: true, winner: 'a' };
  if (bWins === 2 && aWins < 2) return { ok: true, winner: 'b' };
  return { ok: false };
}
```

---

**End of PRD.**
