import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  groupFormat: text("group_format").notNull(),
  koFormat: text("ko_format").notNull().default("bo3_21_cap30"),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id),
  label: text("label").notNull(),
  teamCount: integer("team_count").notNull(),
});

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    seed: integer("seed").notNull(),
    name: text("name").notNull(),
    players: text("players").notNull(),
    companyId: uuid("company_id").references(() => companies.id),
  },
  (t) => [
    uniqueIndex("teams_group_seed_uniq").on(t.groupId, t.seed),
    uniqueIndex("teams_group_name_uniq").on(t.groupId, t.name),
  ],
);

export const courts = pgTable("courts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalKey: text("external_key").notNull().unique(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    stage: text("stage").notNull(),
    groupId: text("group_id").references(() => groups.id),
    roundLabel: text("round_label"),
    slotNumber: integer("slot_number"),
    scheduledTime: text("scheduled_time").notNull(),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    courtId: text("court_id")
      .notNull()
      .references(() => courts.id),
    teamAId: uuid("team_a_id").references(() => teams.id),
    teamBId: uuid("team_b_id").references(() => teams.id),
    teamASource: text("team_a_source"),
    teamBSource: text("team_b_source"),
    status: text("status").notNull().default("scheduled"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    winnerTeamId: uuid("winner_team_id").references(() => teams.id),
    games: jsonb("games").notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("matches_court_time_idx").on(t.courtId, t.scheduledStart),
    index("matches_status_idx").on(t.status),
    index("matches_group_idx").on(t.groupId),
  ],
);

// Substitutes the PRD's `users` table — id mirrors auth.users.id (Supabase Auth).
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("scorer"),
  isActive: boolean("is_active").notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const scorerCourts = pgTable(
  "scorer_courts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    courtId: text("court_id")
      .notNull()
      .references(() => courts.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courtId] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => profiles.id),
    matchId: uuid("match_id").references(() => matches.id),
    action: text("action").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_log_match_idx").on(t.matchId, t.createdAt)],
);

export const groupQualifierOverrides = pgTable("group_qualifier_overrides", {
  groupId: text("group_id")
    .primaryKey()
    .references(() => groups.id),
  winnerTeamId: uuid("winner_team_id").references(() => teams.id),
  runnerUpTeamId: uuid("runner_up_team_id").references(() => teams.id),
  setByUserId: uuid("set_by_user_id").references(() => profiles.id),
  setAt: timestamp("set_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reason: text("reason"),
});

export const groupStandings = pgTable(
  "group_standings",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    played: integer("played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    points: integer("points").notNull().default(0),
    setsWon: integer("sets_won").notNull().default(0),
    setsLost: integer("sets_lost").notNull().default(0),
    ptsScored: integer("pts_scored").notNull().default(0),
    ptsConceded: integer("pts_conceded").notNull().default(0),
    rank: integer("rank"),
    isQualifier: boolean("is_qualifier").notNull().default(false),
    qualifierRole: text("qualifier_role"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.teamId] })],
);
