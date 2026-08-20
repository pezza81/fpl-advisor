import type { SquadPlayer } from "./fpl";

export interface LeagueManagerRow {
  entry: number | string;
  entryName: string;
  managerName: string;
  rank: number;
  lastRank: number;
  total: number;
  eventTotal: number;
  movement: "up" | "down" | "same" | "new";
  weekAheadScore: number | null;
  weekAheadReason: string | null;
  squad: SquadPlayer[];
}

export interface LeagueData {
  leagueId: string;
  leagueName: string;
  gameweek: number;
  isDemo: boolean;
  // False when the league genuinely has no standings yet (e.g. pre-season,
  // or a brand new league with no members) — not an error case.
  hasStandings: boolean;
  managers: LeagueManagerRow[];
}
