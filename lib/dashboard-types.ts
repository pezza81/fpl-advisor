import type { SquadPlayer } from "./fpl";

export interface SeasonHistoryRow {
  event: number;
  points: number;
  totalPoints: number;
  overallRank: number;
  pointsOnBench: number;
  average: number | null;
}

// The full SquadPlayer shape plus health-specific signals — a superset, so
// the dashboard's squad can be passed straight into /api/advice (which
// expects SquadPlayer[]) without reshaping it first.
export interface SquadHealthPlayer extends SquadPlayer {
  trend: "rising" | "declining" | "stable" | "unknown";
  restDays: number | null;
  injuryReason: string | null;
  lineupStatus: "starting" | "bench" | "unknown";
  health: "green" | "amber" | "red";
}

export interface ChipStatus {
  name: string;
  label: string;
  available: boolean;
}

export interface DashboardLeague {
  id: string;
  name: string;
}

export interface WhatsHappeningTile {
  label: string;
  value: string;
  context: string;
}

export interface DashboardData {
  teamId: string;
  managerName: string;
  teamName: string;
  overallPoints: number;
  overallRank: number;
  gameweek: number;
  seasonStarted: boolean;
  isDemo: boolean;
  lastGameweekPoints: number | null;
  lastGameweekAverage: number | null;
  nextDeadline: string | null;
  bank: number;
  squadValue: number;
  chips: ChipStatus[];
  squad: SquadHealthPlayer[];
  seasonHistory: SeasonHistoryRow[];
  leagues: DashboardLeague[];
  whatsHappening: WhatsHappeningTile[];
}
