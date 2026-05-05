// PRD §8 — knockout bracket pairings + source label resolution.
// These constants are the single source of truth; the importer and the
// propagator both read from them.

export type CategoryId = "MB" | "MI" | "W";

export type KoStage = "qf" | "sf" | "final";

export interface KoMatchSpec {
  code: string; // 'QF1', 'SF1', 'F'
  stage: KoStage;
  a: string; // source string — see resolveBracketLabel
  b: string;
  scheduledTime: string; // PRD §8.2
  courtId: string; // 'C1'..'C6'
}

// Source string grammar:
//   group_winner:<groupId>     (e.g. group_winner:MBA)
//   group_runner:<groupId>     (e.g. group_runner:MBD)
//   match_winner:<koCode>      (e.g. match_winner:QF1)
//
// Resolved at import time → team_a_source / team_b_source columns,
// then rewritten to team_a_id / team_b_id by propagateKnockouts.

export const KO_PAIRINGS: Record<CategoryId, KoMatchSpec[]> = {
  MB: [
    { code: "QF1", stage: "qf", a: "group_winner:MBA", b: "group_runner:MBD", scheduledTime: "14:10 - 14:45", courtId: "C1" },
    { code: "QF2", stage: "qf", a: "group_winner:MBB", b: "group_runner:MBC", scheduledTime: "14:10 - 14:45", courtId: "C2" },
    { code: "QF3", stage: "qf", a: "group_winner:MBC", b: "group_runner:MBB", scheduledTime: "14:10 - 14:45", courtId: "C3" },
    { code: "QF4", stage: "qf", a: "group_winner:MBD", b: "group_runner:MBA", scheduledTime: "14:10 - 14:45", courtId: "C4" },
    { code: "SF1", stage: "sf", a: "match_winner:QF1", b: "match_winner:QF4", scheduledTime: "14:50 - 15:25", courtId: "C5" },
    { code: "SF2", stage: "sf", a: "match_winner:QF2", b: "match_winner:QF3", scheduledTime: "14:50 - 15:25", courtId: "C6" },
    { code: "F",   stage: "final", a: "match_winner:SF1", b: "match_winner:SF2", scheduledTime: "15:30 - 16:05", courtId: "C4" },
  ],
  MI: [
    { code: "QF1", stage: "qf", a: "group_winner:MIA", b: "group_runner:MID", scheduledTime: "14:10 - 14:45", courtId: "C5" },
    { code: "QF2", stage: "qf", a: "group_winner:MIB", b: "group_runner:MIC", scheduledTime: "14:10 - 14:45", courtId: "C6" },
    { code: "QF3", stage: "qf", a: "group_winner:MIC", b: "group_runner:MIB", scheduledTime: "14:50 - 15:25", courtId: "C1" },
    { code: "QF4", stage: "qf", a: "group_winner:MID", b: "group_runner:MIA", scheduledTime: "14:50 - 15:25", courtId: "C2" },
    { code: "SF1", stage: "sf", a: "match_winner:QF1", b: "match_winner:QF4", scheduledTime: "15:30 - 16:05", courtId: "C1" },
    { code: "SF2", stage: "sf", a: "match_winner:QF2", b: "match_winner:QF3", scheduledTime: "15:30 - 16:05", courtId: "C2" },
    { code: "F",   stage: "final", a: "match_winner:SF1", b: "match_winner:SF2", scheduledTime: "16:10 - 16:45", courtId: "C1" },
  ],
  W: [
    { code: "SF1", stage: "sf", a: "group_winner:WA", b: "group_runner:WB", scheduledTime: "14:50 - 15:25", courtId: "C3" },
    { code: "SF2", stage: "sf", a: "group_winner:WB", b: "group_runner:WA", scheduledTime: "14:50 - 15:25", courtId: "C4" },
    { code: "F",   stage: "final", a: "match_winner:SF1", b: "match_winner:SF2", scheduledTime: "15:30 - 16:05", courtId: "C3" },
  ],
};

// Convert a source string into the spectator-facing placeholder shown on
// bracket cards before population (e.g. "MB-A Winner", "QF1 Winner").
export function resolveBracketLabel(source: string): string {
  const [kind, value] = source.split(":");
  if (kind === "group_winner") {
    return `${formatGroupCode(value)} Winner`;
  }
  if (kind === "group_runner") {
    return `${formatGroupCode(value)} Runner-up`;
  }
  if (kind === "match_winner") {
    return `${value} Winner`;
  }
  return source;
}

// 'MBA' → 'MB-A'
function formatGroupCode(code: string): string {
  if (code.length < 2) return code;
  return `${code.slice(0, -1)}-${code.slice(-1)}`;
}
