// PRD §7 — group standings + tie-breakers.
// Pure: takes the matches + override row, returns ranked rows.
// No DB access here — caller fetches and persists.

export interface MatchInput {
  id: string;
  status: "scheduled" | "live" | "completed" | "walkover" | "void";
  teamAId: string | null;
  teamBId: string | null;
  winnerTeamId: string | null;
  games: Array<{ a: number; b: number }>;
}

export interface QualifierOverride {
  winnerTeamId: string | null;
  runnerUpTeamId: string | null;
}

export interface StandingRow {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  points: number;
  setsWon: number;
  setsLost: number;
  ptsScored: number;
  ptsConceded: number;
  rank: number;
  isQualifier: boolean;
  qualifierRole: "winner" | "runner_up" | null;
}

export function computeStandings(
  teamIds: string[],
  matches: MatchInput[],
  override: QualifierOverride | null = null,
): StandingRow[] {
  // ── per-team aggregation (PRD §7.2) ────────────────────────────────────────
  const acc = new Map<string, StandingRow>();
  for (const id of teamIds) {
    acc.set(id, {
      teamId: id,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      setsWon: 0,
      setsLost: 0,
      ptsScored: 0,
      ptsConceded: 0,
      rank: 0,
      isQualifier: false,
      qualifierRole: null,
    });
  }

  for (const m of matches) {
    if (m.status !== "completed" && m.status !== "walkover") continue;
    if (!m.teamAId || !m.teamBId) continue;

    const a = acc.get(m.teamAId);
    const b = acc.get(m.teamBId);
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;

    if (m.status === "walkover") {
      // PRD §7.2: walkover = 1 win, 1 set won for declared winner; no points totals.
      if (m.winnerTeamId === m.teamAId) {
        a.wins += 1;
        a.points += 2;
        a.setsWon += 1;
        b.losses += 1;
        b.setsLost += 1;
      } else if (m.winnerTeamId === m.teamBId) {
        b.wins += 1;
        b.points += 2;
        b.setsWon += 1;
        a.losses += 1;
        a.setsLost += 1;
      }
      continue;
    }

    // completed: tally each game
    for (const g of m.games) {
      a.ptsScored += g.a;
      a.ptsConceded += g.b;
      b.ptsScored += g.b;
      b.ptsConceded += g.a;
      if (g.a > g.b) a.setsWon += 1;
      else a.setsLost += 1;
      if (g.b > g.a) b.setsWon += 1;
      else b.setsLost += 1;
    }
    if (m.winnerTeamId === m.teamAId) {
      a.wins += 1;
      a.points += 2;
      b.losses += 1;
    } else if (m.winnerTeamId === m.teamBId) {
      b.wins += 1;
      b.points += 2;
      a.losses += 1;
    }
  }

  // ── h2h lookup: who beat whom (only valid when exactly two teams tied) ─────
  const h2h = new Map<string, string>(); // key = `${winner}|${loser}`
  for (const m of matches) {
    if (m.status !== "completed" && m.status !== "walkover") continue;
    if (!m.teamAId || !m.teamBId || !m.winnerTeamId) continue;
    const loser = m.winnerTeamId === m.teamAId ? m.teamBId : m.teamAId;
    h2h.set(`${m.winnerTeamId}|${loser}`, m.winnerTeamId);
  }

  // ── sort comparator (PRD §7.3) ─────────────────────────────────────────────
  const rows = Array.from(acc.values());

  // First sort: points desc.
  rows.sort((x, y) => y.points - x.points);

  // Within each points bucket, apply tie-breakers.
  // Bucketing lets us detect "exactly 2 teams tied" for the H2H rule.
  const ranked = breakTies(rows, h2h);

  // ── assign ranks + qualifiers ──────────────────────────────────────────────
  ranked.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  if (override?.winnerTeamId || override?.runnerUpTeamId) {
    // PRD §7.4: override wins. Mark only the override slots.
    for (const row of ranked) {
      if (row.teamId === override.winnerTeamId) {
        row.isQualifier = true;
        row.qualifierRole = "winner";
      } else if (row.teamId === override.runnerUpTeamId) {
        row.isQualifier = true;
        row.qualifierRole = "runner_up";
      }
    }
  } else {
    if (ranked[0]) {
      ranked[0].isQualifier = true;
      ranked[0].qualifierRole = "winner";
    }
    if (ranked[1]) {
      ranked[1].isQualifier = true;
      ranked[1].qualifierRole = "runner_up";
    }
  }

  return ranked;
}

function breakTies(
  rows: StandingRow[],
  h2h: Map<string, string>,
): StandingRow[] {
  // Group by points first, then break each tied bucket recursively.
  const buckets: StandingRow[][] = [];
  for (const r of rows) {
    const last = buckets[buckets.length - 1];
    if (last && last[0].points === r.points) {
      last.push(r);
    } else {
      buckets.push([r]);
    }
  }

  const result: StandingRow[] = [];
  for (const bucket of buckets) {
    if (bucket.length === 1) {
      result.push(bucket[0]);
      continue;
    }
    if (bucket.length === 2) {
      // PRD §7.3 step 2: H2H only valid for exactly 2 teams.
      const [x, y] = bucket;
      if (h2h.get(`${x.teamId}|${y.teamId}`)) {
        result.push(x, y);
        continue;
      }
      if (h2h.get(`${y.teamId}|${x.teamId}`)) {
        result.push(y, x);
        continue;
      }
      // No H2H result — fall through to set/points diff.
    }
    bucket.sort((x, y) => {
      const xSetDiff = x.setsWon - x.setsLost;
      const ySetDiff = y.setsWon - y.setsLost;
      if (xSetDiff !== ySetDiff) return ySetDiff - xSetDiff;
      const xPtsDiff = x.ptsScored - x.ptsConceded;
      const yPtsDiff = y.ptsScored - y.ptsConceded;
      if (xPtsDiff !== yPtsDiff) return yPtsDiff - xPtsDiff;
      return 0; // ambiguous — TD toss required
    });
    result.push(...bucket);
  }
  return result;
}
