# SBL 2026 — Implementation Plan

**Companion to:** `SBL_PRD.md` v1.0
**Stack:** Next.js 14+ (App Router) · TypeScript · PostgreSQL (Supabase) · Drizzle · shadcn/ui · Tailwind · next-auth · zod · Vitest · Playwright
**Total estimate:** ~4 working days for one engineer
**Branching model:** one feature branch per phase (e.g. `phase-1-seed`), merged to `main` only after that phase's checkpoint passes

---

## How to use this plan

Each phase has:
- **Goal** — the single user-visible outcome that must work at end of phase
- **Tasks** — ordered work items
- **Screens delivered** — UI routes that should be reachable
- **Checkpoints** — verifiable gates; do **not** start the next phase until every checkpoint in the current phase is green

Each screen has its own checklist of states (loading / empty / error / populated) so nothing ships half-built.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 0 — Foundations (½ day)

**Goal:** A boot-able Next.js app with auth scaffolding, DB connection, and migrations applied. No user-visible features yet — but `pnpm dev` runs and the DB has all tables from PRD §5.

### 0.1 Tasks
- [ ] Initialize package manager (`pnpm`) and lockfile
- [ ] Install runtime deps: `next`, `react`, `react-dom`, `drizzle-orm`, `pg`, `next-auth`, `zod`, `react-hook-form`, `@hookform/resolvers`, `argon2`, `exceljs`, `swr`, `@supabase/supabase-js`
- [ ] Install dev deps: `drizzle-kit`, `tsx`, `vitest`, `@playwright/test`, `@types/node`, `@types/pg`
- [ ] shadcn/ui init: install core primitives (`button`, `card`, `table`, `tabs`, `dialog`, `input`, `form`, `toast`, `badge`, `sheet`)
- [ ] Tailwind v4 + `globals.css` with shadcn tokens
- [ ] `lib/db.ts` — Drizzle client singleton, reads `DATABASE_URL`
- [ ] `drizzle/schema.ts` — translate every table from PRD §5 (categories, groups, companies, teams, courts, matches **with `external_key`**, users, scorer_courts, audit_log, group_qualifier_overrides, group_standings)
- [ ] First migration generated and applied (`pnpm drizzle-kit generate && pnpm drizzle-kit migrate`)
- [ ] `lib/auth.ts` — next-auth credentials provider stub (login API will be wired in Phase 2)
- [ ] `.env.example` with `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `TOURNAMENT_DATE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- [ ] CI: GitHub Actions workflow running `pnpm typecheck && pnpm lint && pnpm test`

### 0.2 Checkpoints
- [ ] **CP-0.1** `pnpm install && pnpm dev` boots without errors; `/` returns the default scaffold page.
- [ ] **CP-0.2** `pnpm typecheck` and `pnpm lint` are clean.
- [ ] **CP-0.3** `psql $DATABASE_URL -c "\dt"` shows all 11 tables from PRD §5.
- [ ] **CP-0.4** `matches` table has the `external_key` UNIQUE column (PRD §6.4).
- [ ] **CP-0.5** A throwaway script can `INSERT` and `SELECT` from `categories` via Drizzle.
- [ ] **CP-0.6** CI is green on `main`.

---

## Phase 1 — Seed + Public Read-only (1 day)

**Goal:** Importer turns the Excel into a fully populated DB; spectator pages render correctly with all-zero standings and unpopulated brackets.

### 1.1 Tasks
- [ ] `scripts/import-fixtures.ts` (PRD §6.2)
  - [ ] Parse `Teams & Groups` → upsert categories, groups, companies, teams
  - [ ] Parse `Group Stage Schedule` → upsert group matches with `external_key = group:<group>:<round>:<slot>:<court>`
  - [ ] Generate KO scaffolding from `KO_PAIRINGS` constant + slot/court table in PRD §8.2 (do **not** read Excel `Knockouts` sheet)
  - [ ] Court ID mapping `Court N` → `CN`
  - [ ] Idempotency: re-run produces no duplicates (PRD §6.4); abort with diff if any matched match is already `completed`
  - [ ] Writes one `audit_log` row with `action='fixture_import'`
- [ ] `lib/standings.ts` — pure `computeStandings(groupId)` function (PRD §7); returns sorted standings with `rank`, `is_qualifier`, `qualifier_role`. Honors `group_qualifier_overrides` if present.
- [ ] `lib/brackets.ts` — `KO_PAIRINGS` constant (PRD Appendix A) + `resolveBracketLabel(source)` for placeholder text like "MB-A Winner"
- [ ] Read-only API routes (PRD §9.1):
  - [ ] `GET /api/categories`
  - [ ] `GET /api/groups?category=`
  - [ ] `GET /api/teams?group=`
  - [ ] `GET /api/standings?group=`
  - [ ] `GET /api/matches?status=` and `?court=`
  - [ ] `GET /api/matches/:id`
  - [ ] `GET /api/bracket?category=`
  - [ ] `GET /api/schedule?slot=`
- [ ] Layout shell: header (logo / nav: Live · Schedule · Standings · Bracket), footer
- [ ] SWR setup with 5s `refreshInterval` for live lists (PRD §10.2)

### 1.2 Screens delivered

#### `/` — Live dashboard
- [ ] Loading skeleton
- [ ] Empty state ("Tournament hasn't started — first slot at 09:00")
- [ ] Populated: live matches grid (one card per court), "next up" row, latest 3 completions
- [ ] Auto-refresh every 5s

#### `/schedule`
- [ ] Filter bar: category, group, court, round, status
- [ ] Mobile-friendly table / card list
- [ ] Empty filter state
- [ ] Default sort: scheduled_start ASC

#### `/standings`
- [ ] Tabs per category (MB · MI · W)
- [ ] Sub-tabs per group (A/B/C/D)
- [ ] Columns: Team · P · W · L · Pts · Set Diff · Pts Diff
- [ ] Top 2 visually flagged (badge: "Q")
- [ ] "TD override" badge when override is set
- [ ] Empty/zero state renders cleanly before any match completes

#### `/bracket`
- [ ] Tabs per category
- [ ] MB/MI: 4 QF + 2 SF + 1 F tree; W: 2 SF + 1 F tree (PRD §11.5)
- [ ] Pre-population: cards show source labels ("MB-A Winner")
- [ ] Click card → match detail

#### `/team/[id]`
- [ ] Team name, players, company, group
- [ ] All matches (past + scheduled) with status & score
- [ ] 404 for invalid id

#### `/court/[id]`
- [ ] Today's full slot list for that court
- [ ] Status badges (scheduled / live / completed)

### 1.3 Checkpoints
- [ ] **CP-1.1** Importer against empty DB creates exactly: 3 categories, 10 groups, 44 teams, 6 courts, 82 group matches, 17 KO scaffolds (PRD §15.1).
- [ ] **CP-1.2** Re-running importer = zero new rows, zero updates to completed matches.
- [ ] **CP-1.3** `GET /api/standings?group=MBA` returns 5 teams, all zero stats, no errors.
- [ ] **CP-1.4** `GET /api/bracket?category=MB` returns 7 matches with `team_a_id`/`team_b_id` null and source labels populated.
- [ ] **CP-1.5** All 6 public screens render without console errors on a 375×667 viewport and a 1440 desktop viewport.
- [ ] **CP-1.6** Unit test: `computeStandings` on a hand-crafted group produces correct ranking through every tie-break path (points → H2H → set diff → points diff).

---

## Phase 2 — Scoring (1 day)

**Goal:** A logged-in scorer can run a match end-to-end on their assigned court. Standings recompute live.

### 2.1 Tasks
- [ ] next-auth credentials provider — verify against `users.pin_hash` (argon2id)
- [ ] Account lockout: increment `failed_attempts`; lock for 15 min after 5 (PRD §12)
- [ ] Rate limit `/api/auth/login` to 10 req/min/IP (middleware)
- [ ] Session middleware on `/scorer/*` and `/admin/*`
- [ ] `lib/format-rules.ts` — copy validators from PRD Appendix B; add `validateScoreUpdate(category, stage, games)` wrapper
- [ ] Mutation routes (PRD §9.3):
  - [ ] `POST /api/matches/:id/start`
  - [ ] `PATCH /api/matches/:id/score` — optimistic lock via `If-Match: <updated_at>` header → 409 on mismatch
  - [ ] `POST /api/matches/:id/complete` — recomputes standings + propagates brackets in same transaction
  - [ ] `POST /api/matches/:id/walkover`
- [ ] Court-scope guard: scorer's `court_id` must be in `scorer_courts` (PRD §9.5); admin bypass
- [ ] `recomputeStandings(groupId)` called inside the same transaction as the match update (PRD §7.5)
- [ ] Audit log writes for `start`, `complete`, `walkover`
- [ ] Seed script for test scorers (e.g. `s1..s6` with PIN `1234`, each assigned to one court; one admin `td/0000`)

### 2.2 Screens delivered

#### `/scorer/login`
- [ ] Username + PIN form (numeric input mode)
- [ ] Inline error: invalid creds, locked account
- [ ] After success → redirect to `/scorer`

#### `/scorer` — My Court(s)
- [ ] Lists assigned courts; per court shows current `live` match (if any) + next `scheduled`
- [ ] Empty state ("No matches scheduled on your courts right now")
- [ ] Sign out button

#### `/scorer/match/[id]` — Score entry
- [ ] Team A card (top) + Team B card (bottom): name, players, **96pt score**, +/− buttons (≥48px tap targets)
- [ ] For KO: 3 set tabs (Set 1 / Set 2 / Set 3); active tab highlighted; only current set is editable
- [ ] Sticky bottom bar: status indicator + `Mark Complete` (disabled until format-valid)
- [ ] Confirmation modal on Mark Complete
- [ ] Undo last point (within current set, pre-complete only)
- [ ] Walkover button → modal to pick winner + reason
- [ ] 409 conflict toast: "Match was updated elsewhere — refresh"
- [ ] Forbidden state when navigating to a match outside scorer's courts

### 2.3 Checkpoints
- [ ] **CP-2.1** PRD §15.2: scorer assigned to Court 1 starts → scores → completes the first MBA match. Status transitions exactly `scheduled → live → completed`.
- [ ] **CP-2.2** After completing all 10 MB-A matches, `/standings` shows `played=4` per team and ranks honor PRD §7.3.
- [ ] **CP-2.3** Scorer assigned to Court 1 calling `POST /api/matches/:courtTwoMatch/start` returns 403.
- [ ] **CP-2.4** Two browsers post `PATCH /api/matches/:id/score` with the same `If-Match` value → second gets 409.
- [ ] **CP-2.5** Submitting score `18-15` on a to-21 MI group match returns 400 with `not_finished` reason.
- [ ] **CP-2.6** PINs in DB are argon2id hashes; 5 wrong PINs sets `locked_until` 15 min in the future (PRD §15.6).
- [ ] **CP-2.7** Score-entry screen passes a manual test on a 375×667 viewport: every tap target ≥48px, score numerals legible from 1m away.

---

## Phase 3 — Brackets + Realtime (½ day)

**Goal:** Completing group matches auto-fills the KO bracket; spectators see updates within 10s.

### 3.1 Tasks
- [ ] `propagateKnockouts(categoryId)` (PRD §8.3)
  - [ ] After group completion: if all group matches in category are completed AND standings unambiguous → fill QFs (or W SFs)
  - [ ] After KO match completion: fill the next stage's `team_a_id`/`team_b_id` via `team_a_source` / `team_b_source` resolution
  - [ ] Override-aware: `group_qualifier_overrides` wins over computed qualifier
  - [ ] Idempotent: re-running on same state changes nothing
- [ ] Hook `propagateKnockouts` into `complete` and `walkover` endpoints (after standings recompute, same transaction)
- [ ] Ambiguity detection: if standings unresolved, mark affected QF cards with `awaiting_td` flag (computed at read time — no schema change needed)
- [ ] Realtime decision (PRD §10.3): default to Supabase Realtime
  - [ ] Enable Realtime on `matches` and `group_standings` tables
  - [ ] `lib/realtime.ts` — `useLiveMatches()`, `useLiveStandings(groupId)` hooks
  - [ ] Wire into `/`, `/standings`, `/bracket`, `/court/[id]`
  - [ ] Fallback: SWR 5s polling if `SUPABASE_URL` is unset

### 3.2 Screens updated
- [ ] `/bracket` — populated team names appear within 10s of group completion; "Awaiting TD decision" banner on ambiguous QFs
- [ ] `/` — completed-match toast / headline updates push live
- [ ] `/standings` — pushes update on each match completion

### 3.3 Checkpoints
- [ ] **CP-3.1** PRD §15.3: completing all MB-A and MB-D group matches populates MB QF1 and MB QF4 with the correct team IDs (winner of A + runner-up of D, etc.).
- [ ] **CP-3.2** Completing all 4 MB QFs populates MB SF1 = winner(QF1) vs winner(QF4) and SF2 = winner(QF2) vs winner(QF3) (PRD §8.1).
- [ ] **CP-3.3** PRD §15.4: spectator with `/standings` open sees a refreshed score within 10s of "Mark Complete".
- [ ] **CP-3.4** Forcing a 3-way tie (manually crafted scores) leaves QF cards with `awaiting_td` and bracket does not auto-populate.
- [ ] **CP-3.5** Unit tests for `propagateKnockouts` cover: happy path, override path, ambiguous standings, idempotency.

---

## Phase 4 — Admin (½ day)

**Goal:** TD can override anything safely. Every override is auditable.

### 4.1 Tasks
- [ ] Admin route guard (role=`admin`)
- [ ] Admin endpoints (PRD §9.4):
  - [ ] `POST /api/admin/matches/:id/correct`
  - [ ] `POST /api/admin/groups/:id/override`
  - [ ] `POST /api/admin/users` / `PATCH /api/admin/users/:id`
  - [ ] `POST /api/admin/import-fixtures` (returns diff first; second call with `force=true` applies)
  - [ ] `GET /api/admin/audit-log?match=:id`
- [ ] Override propagation: setting a group override triggers `propagateKnockouts`; if affected KO match is `live`/`completed`, return error requiring void/reset (PRD §14)
- [ ] Voiding / repopulating KO matches when standings change

### 4.2 Screens delivered

#### `/admin`
- [ ] Counts overview: matches by status, groups with ambiguous standings, scorers online
- [ ] Quick-jump links to overrides / users / audit

#### `/admin/matches`
- [ ] Full table with filters (category, group, court, status)
- [ ] Bulk view; click → admin match editor

#### `/admin/matches/[id]`
- [ ] All scorer controls + score-correction on completed matches (with required `reason` text field)
- [ ] Expandable audit history inline

#### `/admin/users`
- [ ] List with active/inactive toggle
- [ ] Create scorer dialog (username, display name, PIN, court assignments multi-select)
- [ ] Reset PIN dialog
- [ ] Assign / unassign courts

#### `/admin/groups/[id]/override`
- [ ] Current computed standings
- [ ] Pickers for winner & runner-up + required `reason`
- [ ] Warning if any downstream KO match is `live`/`completed`

#### `/admin/audit`
- [ ] Reverse-chronological log; filter by match, user, action

### 4.3 Checkpoints
- [ ] **CP-4.1** PRD §15.5a: admin corrects a completed match's score → change appears in audit log with before/after JSON.
- [ ] **CP-4.2** PRD §15.5b: admin sets manual qualifier override → bracket repopulates within 10s.
- [ ] **CP-4.3** Setting override that would change a `completed` KO match returns a clear error and does not corrupt state.
- [ ] **CP-4.4** Re-import endpoint returns a diff JSON; `force=true` applies and writes one `audit_log` row.
- [ ] **CP-4.5** Non-admin scorer hitting any `/api/admin/*` route gets 403.

---

## Phase 5 — Polish, Testing & Hardening (½ day)

**Goal:** Production-ready. All acceptance criteria green. Empty/error states everywhere. CI gates merges.

### 5.1 Tasks
- [ ] Unit tests
  - [ ] `lib/standings.ts` — every PRD §7.3 tie-break path; H2H 2-team rule + 3-way skip
  - [ ] `lib/brackets.ts` — pairings + propagation + override precedence
  - [ ] `lib/format-rules.ts` — group MB/W (≥1 lead, no cap), group MI (cap 30), KO (bo3, cap 30)
- [ ] Playwright e2e: scorer logs in → completes a match → spectator sees update (PRD acceptance)
- [ ] Error states: 404, 403, 500 fallback pages
- [ ] Empty states audited on every screen (Phase 1 & 2 & 4 lists)
- [ ] Loading skeletons on every async screen
- [ ] Network-failure handling on score submit: retry button + single-flight queue (PRD §12)
- [ ] Accessibility pass: focus rings, ARIA labels, table semantics, color contrast on score cards
- [ ] CSRF protection on all mutations (next-auth handles via session, verify)
- [ ] Performance: load test the 6 hottest GET endpoints (each <300ms p95 with full tournament loaded)
- [ ] README.md update: setup, env vars, importer command, test scorer creds
- [ ] Deploy guide (Vercel + Supabase) with env-var checklist

### 5.2 Checkpoints
- [ ] **CP-5.1** All PRD §15 acceptance criteria boxes (15.1–15.6) checked off.
- [ ] **CP-5.2** `pnpm test` green; line coverage on `lib/` ≥80%.
- [ ] **CP-5.3** Playwright e2e green in CI.
- [ ] **CP-5.4** Lighthouse mobile audit ≥90 for Performance and Accessibility on `/`, `/standings`, `/scorer/match/[id]`.
- [ ] **CP-5.5** Manual smoke on staging: import fixtures → log in as scorer → run 5 group matches → as admin override one group → bracket fills correctly.

---

## Cross-cutting concerns (apply throughout)

These aren't a phase — they're standards every PR must meet.

- **Concurrency**: every mutation uses `If-Match: updated_at` and returns 409 on stale (PRD §12)
- **Validation**: every endpoint has a zod schema; same schema reused on the client
- **Audit**: any admin mutation writes to `audit_log` with `before_json` / `after_json`
- **No client-only auth**: every protected route checks session server-side
- **No raw SQL in handlers**: go through Drizzle; queries that grow complex move to `lib/queries/`
- **Empty/loading/error**: each new screen lands with all four states or it's not done

---

## Risk register

| Risk | Mitigation |
|---|---|
| Excel sheet column names shift between revisions | Importer asserts expected column headers; fail fast with clear error |
| Realtime flakiness on tournament Wi-Fi | SWR fallback path (PRD §10.2) — switchable via env var |
| Scorer's phone goes offline mid-set | Local single-flight queue + server-side state of record (PRD §14) |
| TD makes override that conflicts with live KO match | Admin endpoint refuses; requires explicit void first |
| Three-way tie with identical diffs | UI shows "Awaiting TD decision"; bracket waits for override |
| Re-import after matches played | Importer aborts on diff; force flag required and audited |

---

## Open items to confirm with TD before deploy (PRD §17)

- [ ] Tournament date → set `TOURNAMENT_DATE` env var
- [ ] Walkover scoring convention (default: 1 win, 1 set, 0 points)
- [ ] H2H with 3+ tied teams (default: skip to set diff)
- [ ] MB/W cap (default: no cap, first to 15 by ≥1)
- [ ] Knock-up time tracking (default: not tracked)

---

**End of Implementation Plan.**
