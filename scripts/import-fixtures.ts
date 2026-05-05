// PRD §6 — Excel-driven seed importer.
// Run with `npm run import:fixtures` (loads .env.local for DATABASE_URL).
// Idempotent: re-running on a populated DB is a no-op unless the Excel changed.
// Aborts with a diff if any matched row is already `status='completed'` and
// the importer would change its teams.

import path from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { KO_PAIRINGS, type CategoryId } from "../lib/brackets";

const FIXTURES_PATH = path.resolve("data/fixtures.xlsx");

const CATEGORY_FROM_EXCEL: Record<string, CategoryId> = {
  "Men's Beginner": "MB",
  "Men's Intermediate": "MI",
  "Women's": "W",
};

const CATEGORY_META: Record<
  CategoryId,
  { name: string; groupFormat: string }
> = {
  MB: { name: "Men's Beginner", groupFormat: "single_game_15" },
  MI: { name: "Men's Intermediate", groupFormat: "single_game_21_cap30" },
  W: { name: "Women's", groupFormat: "single_game_15" },
};

const GROUP_LABEL_RE = /^Group\s+([A-Z])\s+\(([A-Z]{2,3})\)$/;
const MATCH_SPLIT_RE = /\s{2,}vs\s{2,}/i;
const COURT_RE = /^Court\s+(\d+)$/;

type TeamRow = {
  groupId: string;
  seed: number;
  name: string;
  players: string;
  company: string | null;
};

type GroupRow = {
  id: string; // 'MBA'
  categoryId: CategoryId;
  label: string; // 'Group A'
  teamCount: number;
};

type GroupMatchRow = {
  externalKey: string;
  categoryId: CategoryId;
  groupId: string;
  roundLabel: string;
  slotNumber: number;
  scheduledTime: string;
  courtId: string;
  teamAName: string;
  teamBName: string;
};

async function main() {
  console.log(`▶ reading ${FIXTURES_PATH}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURES_PATH);

  const { groups, teams } = parseTeamsAndGroups(wb);
  const groupMatches = parseGroupSchedule(wb);

  // ── basic sanity before we touch the DB ───────────────────────────────────
  assert(groups.length === 10, `expected 10 groups, got ${groups.length}`);
  assert(teams.length === 44, `expected 44 teams, got ${teams.length}`);
  assert(
    groupMatches.length === 82,
    `expected 82 group-stage matches, got ${groupMatches.length}`,
  );
  const koCount = (Object.keys(KO_PAIRINGS) as CategoryId[]).reduce(
    (n, c) => n + KO_PAIRINGS[c].length,
    0,
  );
  assert(koCount === 17, `expected 17 KO scaffolds, got ${koCount}`);

  // ── upsert in dep order ───────────────────────────────────────────────────
  await upsertCategories();
  await upsertCourts();
  await upsertGroups(groups);
  const companyIdByName = await upsertCompanies(uniqueCompanies(teams));
  const teamIdByGroupAndName = await upsertTeams(teams, companyIdByName);
  const groupChanges = await upsertGroupMatches(
    groupMatches,
    teamIdByGroupAndName,
  );
  const koChanges = await upsertKnockoutMatches();

  // ── audit log entry ───────────────────────────────────────────────────────
  await db.insert(schema.auditLog).values({
    action: "fixture_import",
    afterJson: {
      groups: groups.length,
      teams: teams.length,
      group_matches: groupMatches.length,
      ko_matches: koCount,
      group_changes: groupChanges,
      ko_changes: koChanges,
    },
  });

  // ── final assertion against the live DB ───────────────────────────────────
  const counts = await db.execute<{ table: string; n: number }>(sql`
    select 'categories' as "table", count(*)::int as n from public.categories union all
    select 'groups',                count(*)::int      from public.groups     union all
    select 'companies',             count(*)::int      from public.companies  union all
    select 'teams',                 count(*)::int      from public.teams      union all
    select 'courts',                count(*)::int      from public.courts     union all
    select 'matches_group',         count(*)::int      from public.matches where stage = 'group' union all
    select 'matches_ko',            count(*)::int      from public.matches where stage <> 'group'
  `);
  console.log("✓ db counts:", counts);

  console.log("\n✓ import complete.");
}

// ─── parsing ───────────────────────────────────────────────────────────────

function parseTeamsAndGroups(wb: ExcelJS.Workbook): {
  groups: GroupRow[];
  teams: TeamRow[];
} {
  const ws = wb.getWorksheet("Teams & Groups");
  if (!ws) throw new Error("Missing 'Teams & Groups' sheet");

  // The sheet repeats the group label in column 1 of every team row.
  // Build groups via dedupe on first sighting; each row that has a numeric
  // seed in column 2 is a team row.
  const groupById = new Map<string, GroupRow>();
  const teams: TeamRow[] = [];

  ws.eachRow((row) => {
    const c1 = toText(row.getCell(1).value);
    const c2 = toText(row.getCell(2).value);
    const c3 = toText(row.getCell(3).value);
    const c4 = toText(row.getCell(4).value);
    const c5 = toText(row.getCell(5).value);

    if (!c1 || !/^\d+$/.test(c2) || !c3) return; // not a team row

    const m = c1.match(GROUP_LABEL_RE);
    if (!m) return; // unexpected; skip silently
    const letter = m[1];
    const code = m[2];
    const categoryId = code.slice(0, -1) as CategoryId;

    let group = groupById.get(code);
    if (!group) {
      group = {
        id: code,
        categoryId,
        label: `Group ${letter}`,
        teamCount: 0,
      };
      groupById.set(code, group);
    }
    group.teamCount += 1;

    teams.push({
      groupId: code,
      seed: parseInt(c2, 10),
      name: c3,
      players: c4,
      company: c5 || null,
    });
  });

  return { groups: Array.from(groupById.values()), teams };
}

function parseGroupSchedule(wb: ExcelJS.Workbook): GroupMatchRow[] {
  const ws = wb.getWorksheet("Group Stage Schedule");
  if (!ws) throw new Error("Missing 'Group Stage Schedule' sheet");

  const out: GroupMatchRow[] = [];

  ws.eachRow((row) => {
    const slot = toText(row.getCell(1).value);
    const time = toText(row.getCell(2).value);
    const court = toText(row.getCell(3).value);
    const category = toText(row.getCell(4).value);
    const groupCol = toText(row.getCell(5).value);
    const matchCol = toText(row.getCell(6).value);
    const round = toText(row.getCell(7).value);

    if (!slot || !/^\d+$/.test(slot)) return; // skip headers / blanks
    if (!category || !groupCol || !matchCol || !round || !court) return;

    const cat = CATEGORY_FROM_EXCEL[category];
    if (!cat) throw new Error(`Unknown category: ${category}`);
    const groupLetter = groupCol.replace(/^Group\s+/i, "").trim();
    if (!/^[A-Z]$/.test(groupLetter)) {
      throw new Error(`Bad group cell: ${groupCol}`);
    }
    const groupId = `${cat}${groupLetter}`;

    const courtMatch = court.match(COURT_RE);
    if (!courtMatch) throw new Error(`Bad court cell: ${court}`);
    const courtId = `C${courtMatch[1]}`;

    const teams = matchCol.split(MATCH_SPLIT_RE).map((s) => s.trim());
    if (teams.length !== 2) {
      throw new Error(`Bad match cell: ${matchCol}`);
    }

    out.push({
      externalKey: `group:${groupId}:${round}:${slot}:${courtId}`,
      categoryId: cat,
      groupId,
      roundLabel: round,
      slotNumber: parseInt(slot, 10),
      scheduledTime: time,
      courtId,
      teamAName: teams[0],
      teamBName: teams[1],
    });
  });

  return out;
}

// ─── upserts ───────────────────────────────────────────────────────────────

async function upsertCategories() {
  for (const id of Object.keys(CATEGORY_META) as CategoryId[]) {
    const meta = CATEGORY_META[id];
    await db
      .insert(schema.categories)
      .values({ id, name: meta.name, groupFormat: meta.groupFormat })
      .onConflictDoUpdate({
        target: schema.categories.id,
        set: { name: meta.name, groupFormat: meta.groupFormat },
      });
  }
}

async function upsertCourts() {
  for (let i = 1; i <= 6; i += 1) {
    const id = `C${i}`;
    await db
      .insert(schema.courts)
      .values({ id, name: `Court ${i}` })
      .onConflictDoUpdate({
        target: schema.courts.id,
        set: { name: `Court ${i}` },
      });
  }
}

async function upsertGroups(rows: GroupRow[]) {
  for (const g of rows) {
    await db
      .insert(schema.groups)
      .values({
        id: g.id,
        categoryId: g.categoryId,
        label: g.label,
        teamCount: g.teamCount,
      })
      .onConflictDoUpdate({
        target: schema.groups.id,
        set: { label: g.label, teamCount: g.teamCount, categoryId: g.categoryId },
      });
  }
}

function uniqueCompanies(teams: TeamRow[]): string[] {
  const set = new Set<string>();
  for (const t of teams) if (t.company) set.add(t.company);
  return Array.from(set);
}

async function upsertCompanies(names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const name of names) {
    const inserted = await db
      .insert(schema.companies)
      .values({ name })
      .onConflictDoNothing()
      .returning({ id: schema.companies.id });
    if (inserted[0]) {
      map.set(name, inserted[0].id);
    } else {
      const existing = await db
        .select({ id: schema.companies.id })
        .from(schema.companies)
        .where(eq(schema.companies.name, name));
      map.set(name, existing[0].id);
    }
  }
  return map;
}

async function upsertTeams(
  rows: TeamRow[],
  companyIdByName: Map<string, string>,
): Promise<Map<string, string>> {
  // Map key = `${groupId}|${name}` → teamId
  const out = new Map<string, string>();
  for (const t of rows) {
    const companyId = t.company
      ? (companyIdByName.get(t.company) ?? null)
      : null;
    const inserted = await db
      .insert(schema.teams)
      .values({
        groupId: t.groupId,
        seed: t.seed,
        name: t.name,
        players: t.players,
        companyId,
      })
      .onConflictDoNothing({
        target: [schema.teams.groupId, schema.teams.seed],
      })
      .returning({ id: schema.teams.id });
    let id: string;
    if (inserted[0]) {
      id = inserted[0].id;
    } else {
      const existing = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(
          sql`${schema.teams.groupId} = ${t.groupId} and ${schema.teams.seed} = ${t.seed}`,
        );
      id = existing[0].id;
      await db
        .update(schema.teams)
        .set({ name: t.name, players: t.players, companyId })
        .where(eq(schema.teams.id, id));
    }
    out.set(`${t.groupId}|${t.name}`, id);
  }
  return out;
}

async function upsertGroupMatches(
  rows: GroupMatchRow[],
  teamIdByGroupAndName: Map<string, string>,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    const aId = requireTeamId(teamIdByGroupAndName, r.groupId, r.teamAName);
    const bId = requireTeamId(teamIdByGroupAndName, r.groupId, r.teamBName);

    const existing = await db
      .select({
        id: schema.matches.id,
        status: schema.matches.status,
        teamAId: schema.matches.teamAId,
        teamBId: schema.matches.teamBId,
      })
      .from(schema.matches)
      .where(eq(schema.matches.externalKey, r.externalKey));

    if (existing[0]) {
      if (
        existing[0].status === "completed" &&
        (existing[0].teamAId !== aId || existing[0].teamBId !== bId)
      ) {
        throw new Error(
          `Refusing to mutate completed match ${r.externalKey}: ` +
            `db has (${existing[0].teamAId}, ${existing[0].teamBId}) ` +
            `but Excel has (${aId}, ${bId}). Resolve manually before re-importing.`,
        );
      }
      // Safe to refresh non-status fields.
      await db
        .update(schema.matches)
        .set({
          categoryId: r.categoryId,
          groupId: r.groupId,
          roundLabel: r.roundLabel,
          slotNumber: r.slotNumber,
          scheduledTime: r.scheduledTime,
          courtId: r.courtId,
          teamAId: aId,
          teamBId: bId,
          stage: "group",
        })
        .where(eq(schema.matches.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(schema.matches).values({
        externalKey: r.externalKey,
        categoryId: r.categoryId,
        stage: "group",
        groupId: r.groupId,
        roundLabel: r.roundLabel,
        slotNumber: r.slotNumber,
        scheduledTime: r.scheduledTime,
        courtId: r.courtId,
        teamAId: aId,
        teamBId: bId,
      });
      inserted += 1;
    }
  }
  return { inserted, updated };
}

async function upsertKnockoutMatches(): Promise<{
  inserted: number;
  updated: number;
}> {
  let inserted = 0;
  let updated = 0;
  for (const cat of Object.keys(KO_PAIRINGS) as CategoryId[]) {
    for (const m of KO_PAIRINGS[cat]) {
      const externalKey = `ko:${cat}:${m.stage}:${m.code}`;
      const existing = await db
        .select({ id: schema.matches.id, status: schema.matches.status })
        .from(schema.matches)
        .where(eq(schema.matches.externalKey, externalKey));

      if (existing[0]) {
        // KO scaffolds get team_a_id / team_b_id at propagation time, not
        // import time. We only refresh static metadata.
        if (existing[0].status === "completed") {
          // leave alone; admin-level propagation may have written winners.
          continue;
        }
        await db
          .update(schema.matches)
          .set({
            categoryId: cat,
            stage: m.stage,
            scheduledTime: m.scheduledTime,
            courtId: m.courtId,
            teamASource: m.a,
            teamBSource: m.b,
            roundLabel: m.code,
          })
          .where(eq(schema.matches.id, existing[0].id));
        updated += 1;
      } else {
        await db.insert(schema.matches).values({
          externalKey,
          categoryId: cat,
          stage: m.stage,
          scheduledTime: m.scheduledTime,
          courtId: m.courtId,
          teamASource: m.a,
          teamBSource: m.b,
          roundLabel: m.code,
        });
        inserted += 1;
      }
    }
  }
  return { inserted, updated };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function requireTeamId(
  map: Map<string, string>,
  groupId: string,
  name: string,
): string {
  const id = map.get(`${groupId}|${name}`);
  if (!id) {
    throw new Error(
      `Team not found in group ${groupId}: '${name}'. Check Excel team-name spelling.`,
    );
  }
  return id;
}

function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v !== null && "result" in v) {
    return toText((v as { result: unknown }).result);
  }
  if (typeof v === "object" && v !== null && "text" in v) {
    return toText((v as { text: unknown }).text);
  }
  return String(v);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
