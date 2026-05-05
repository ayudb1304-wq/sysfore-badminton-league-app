// Server-side data layer. Uses Drizzle (DATABASE_URL = postgres user, bypasses RLS).
// Both API routes and server components call into this; tests can mock the db arg.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  computeStandings,
  type MatchInput,
  type StandingRow,
} from "@/lib/standings";
import {
  KO_PAIRINGS,
  resolveBracketLabel,
  type CategoryId,
} from "@/lib/brackets";

// ─── reference data ─────────────────────────────────────────────────────────

export async function listCategories() {
  return db.select().from(schema.categories).orderBy(asc(schema.categories.id));
}

export async function listGroupsByCategory(categoryId: string) {
  return db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.categoryId, categoryId))
    .orderBy(asc(schema.groups.id));
}

export async function listAllGroups() {
  return db.select().from(schema.groups).orderBy(asc(schema.groups.id));
}

export async function listTeamsByGroup(groupId: string) {
  return db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      seed: schema.teams.seed,
      players: schema.teams.players,
      groupId: schema.teams.groupId,
      companyName: schema.companies.name,
    })
    .from(schema.teams)
    .leftJoin(schema.companies, eq(schema.teams.companyId, schema.companies.id))
    .where(eq(schema.teams.groupId, groupId))
    .orderBy(asc(schema.teams.seed));
}

export async function getTeam(id: string) {
  const rows = await db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      seed: schema.teams.seed,
      players: schema.teams.players,
      groupId: schema.teams.groupId,
      groupLabel: schema.groups.label,
      categoryId: schema.groups.categoryId,
      companyName: schema.companies.name,
    })
    .from(schema.teams)
    .leftJoin(schema.companies, eq(schema.teams.companyId, schema.companies.id))
    .innerJoin(schema.groups, eq(schema.teams.groupId, schema.groups.id))
    .where(eq(schema.teams.id, id));
  return rows[0] ?? null;
}

export async function getCourt(id: string) {
  const rows = await db
    .select()
    .from(schema.courts)
    .where(eq(schema.courts.id, id));
  return rows[0] ?? null;
}

export async function listCourts() {
  return db.select().from(schema.courts).orderBy(asc(schema.courts.id));
}

// ─── matches ───────────────────────────────────────────────────────────────

type MatchListOpts = {
  status?: string;
  courtId?: string;
  categoryId?: string;
  groupId?: string;
  slotNumber?: number;
};

export type MatchListRow = Awaited<ReturnType<typeof listMatches>>[number];

export async function listMatches(opts: MatchListOpts = {}) {
  const conditions = [] as ReturnType<typeof eq>[];
  if (opts.status) conditions.push(eq(schema.matches.status, opts.status));
  if (opts.courtId) conditions.push(eq(schema.matches.courtId, opts.courtId));
  if (opts.categoryId)
    conditions.push(eq(schema.matches.categoryId, opts.categoryId));
  if (opts.groupId) conditions.push(eq(schema.matches.groupId, opts.groupId));
  if (typeof opts.slotNumber === "number")
    conditions.push(eq(schema.matches.slotNumber, opts.slotNumber));

  return db
    .select({
      id: schema.matches.id,
      externalKey: schema.matches.externalKey,
      categoryId: schema.matches.categoryId,
      stage: schema.matches.stage,
      groupId: schema.matches.groupId,
      roundLabel: schema.matches.roundLabel,
      slotNumber: schema.matches.slotNumber,
      scheduledTime: schema.matches.scheduledTime,
      courtId: schema.matches.courtId,
      teamAId: schema.matches.teamAId,
      teamBId: schema.matches.teamBId,
      teamASource: schema.matches.teamASource,
      teamBSource: schema.matches.teamBSource,
      teamAName:
        sql<string | null>`(select name from public.teams where id = ${schema.matches.teamAId})`.as(
          "team_a_name",
        ),
      teamBName:
        sql<string | null>`(select name from public.teams where id = ${schema.matches.teamBId})`.as(
          "team_b_name",
        ),
      status: schema.matches.status,
      games: schema.matches.games,
      winnerTeamId: schema.matches.winnerTeamId,
      startedAt: schema.matches.startedAt,
      endedAt: schema.matches.endedAt,
    })
    .from(schema.matches)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      asc(schema.matches.slotNumber),
      asc(schema.matches.scheduledTime),
      asc(schema.matches.courtId),
    );
}

export async function getMatch(id: string) {
  const rows = await listMatches();
  return rows.find((m) => m.id === id) ?? null;
}

// ─── standings ─────────────────────────────────────────────────────────────

export type StandingsView = {
  groupId: string;
  groupLabel: string;
  categoryId: string;
  rows: Array<
    StandingRow & { teamName: string; seed: number; players: string }
  >;
  overrideApplied: boolean;
};

export async function getStandings(groupId: string): Promise<StandingsView | null> {
  const groupRows = await db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId));
  const group = groupRows[0];
  if (!group) return null;

  const teamRows = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.groupId, groupId));
  const teamIds = teamRows.map((t) => t.id);

  const matches = await db
    .select({
      id: schema.matches.id,
      status: schema.matches.status,
      teamAId: schema.matches.teamAId,
      teamBId: schema.matches.teamBId,
      winnerTeamId: schema.matches.winnerTeamId,
      games: schema.matches.games,
    })
    .from(schema.matches)
    .where(eq(schema.matches.groupId, groupId));

  const matchInputs: MatchInput[] = matches.map((m) => ({
    id: m.id,
    status: m.status as MatchInput["status"],
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    winnerTeamId: m.winnerTeamId,
    games: (m.games as Array<{ a: number; b: number }>) ?? [],
  }));

  const overrideRows = await db
    .select()
    .from(schema.groupQualifierOverrides)
    .where(eq(schema.groupQualifierOverrides.groupId, groupId));
  const override = overrideRows[0] ?? null;

  const computed = computeStandings(
    teamIds,
    matchInputs,
    override
      ? {
          winnerTeamId: override.winnerTeamId,
          runnerUpTeamId: override.runnerUpTeamId,
        }
      : null,
  );

  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const rows = computed.map((row) => {
    const t = teamById.get(row.teamId)!;
    return {
      ...row,
      teamName: t.name,
      seed: t.seed,
      players: t.players,
    };
  });

  return {
    groupId: group.id,
    groupLabel: group.label,
    categoryId: group.categoryId,
    rows,
    overrideApplied: !!override,
  };
}

// ─── bracket ───────────────────────────────────────────────────────────────

export type BracketCard = {
  id: string;
  code: string; // 'QF1' | 'SF1' | 'F'
  stage: "qf" | "sf" | "final";
  scheduledTime: string;
  courtId: string;
  status: string;
  teamAId: string | null;
  teamBId: string | null;
  teamASource: string | null;
  teamBSource: string | null;
  teamALabel: string; // resolved name OR placeholder
  teamBLabel: string;
  games: Array<{ a: number; b: number }>;
  winnerTeamId: string | null;
};

export async function getBracket(categoryId: CategoryId): Promise<BracketCard[]> {
  const rows = await db
    .select({
      id: schema.matches.id,
      roundLabel: schema.matches.roundLabel,
      stage: schema.matches.stage,
      scheduledTime: schema.matches.scheduledTime,
      courtId: schema.matches.courtId,
      status: schema.matches.status,
      teamAId: schema.matches.teamAId,
      teamBId: schema.matches.teamBId,
      teamASource: schema.matches.teamASource,
      teamBSource: schema.matches.teamBSource,
      games: schema.matches.games,
      winnerTeamId: schema.matches.winnerTeamId,
      teamAName: sql<
        string | null
      >`(select name from public.teams where id = ${schema.matches.teamAId})`.as(
        "team_a_name",
      ),
      teamBName: sql<
        string | null
      >`(select name from public.teams where id = ${schema.matches.teamBId})`.as(
        "team_b_name",
      ),
    })
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.categoryId, categoryId),
        inArray(schema.matches.stage, ["qf", "sf", "final"]),
      ),
    );

  // Order by stage (qf < sf < final), then by code (QF1..QF4)
  const stageRank = { qf: 0, sf: 1, final: 2 } as const;
  rows.sort((a, b) => {
    const sa = stageRank[a.stage as keyof typeof stageRank] ?? 9;
    const sb = stageRank[b.stage as keyof typeof stageRank] ?? 9;
    if (sa !== sb) return sa - sb;
    return (a.roundLabel ?? "").localeCompare(b.roundLabel ?? "");
  });

  return rows.map((r) => ({
    id: r.id,
    code: r.roundLabel ?? "",
    stage: r.stage as BracketCard["stage"],
    scheduledTime: r.scheduledTime,
    courtId: r.courtId,
    status: r.status,
    teamAId: r.teamAId,
    teamBId: r.teamBId,
    teamASource: r.teamASource,
    teamBSource: r.teamBSource,
    teamALabel: r.teamAName ?? (r.teamASource ? resolveBracketLabel(r.teamASource) : "TBD"),
    teamBLabel: r.teamBName ?? (r.teamBSource ? resolveBracketLabel(r.teamBSource) : "TBD"),
    games: (r.games as Array<{ a: number; b: number }>) ?? [],
    winnerTeamId: r.winnerTeamId,
  }));
}

// Useful to know all the (categoryId, koCount) pairs for the bracket page.
export function knownBracketCategories(): CategoryId[] {
  return Object.keys(KO_PAIRINGS) as CategoryId[];
}
