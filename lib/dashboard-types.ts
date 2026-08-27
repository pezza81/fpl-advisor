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

export interface TransferHistoryEntry {
  event: number;
  soldName: string;
  boughtName: string;
  // 0 for a free transfer, -4 for each transfer beyond the free allowance
  // that gameweek — FPL only tracks this cost per gameweek, not per swap, so
  // when several transfers land in the same gameweek this is an even split
  // rather than an authoritative per-transfer figure (see buildTransferHistory).
  costPoints: number;
}

export interface UpcomingChanges {
  captainName: string | null;
  viceCaptainName: string | null;
  transfersThisGameweek: number;
  transfersCostThisGameweek: number;
  // null only when there's no season/chip history to simulate from at all
  // (shouldn't happen once seasonStarted is true, kept for safety).
  freeTransfersNextWeek: number | null;
  chipsActivatedThisGameweek: string[];
}

export interface DashboardData {
  teamId: string;
  managerName: string;
  teamName: string;
  overallPoints: number;
  overallRank: number;
  totalPlayers: number;
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
  transferHistory: TransferHistoryEntry[];
  upcoming: UpcomingChanges;
}
