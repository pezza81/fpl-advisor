// FPL's own per-player endpoint carries an official historical archive
// (`history_past`) going back multiple seasons — including bonus points and
// clean sheets, neither of which API-Football (our other historical source,
// see lib/football-trends.ts) tracks at all. Unlike that source, this one
// isn't rate-limited and is matched by exact FPL element id rather than
// fuzzy name matching, so it's the more reliable source for a specific
// player's own season-by-season line.

export interface FplSeasonRow {
  seasonLabel: string; // e.g. "2023/24"
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  bonus: number;
  involvements: number;
  totalPoints: number; // real, official season total from FPL — not an estimate
}

interface FplHistoryPastSeason {
  season_name: string;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  saves: number;
  bonus: number;
  total_points: number;
}

interface FplElementSummaryResponse {
  history_past?: FplHistoryPastSeason[];
}

// Returns the last `limit` seasons (oldest first) the player actually has
// minutes for — filters out blank placeholder rows FPL sometimes carries
// for a player's pre-Premier-League youth/loan years.
export async function fetchFplSeasonHistory(
  elementId: number,
  limit = 3,
): Promise<FplSeasonRow[]> {
  if (elementId <= 0) return [];

  const res = await fetch(`https://fantasy.premierleague.com/api/element-summary/${elementId}/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as FplElementSummaryResponse;
  const pastSeasons = Array.isArray(data.history_past) ? data.history_past : [];

  return pastSeasons
    .filter((season) => season.minutes > 0)
    .slice(-limit)
    .map((season) => ({
      seasonLabel: season.season_name,
      minutes: season.minutes,
      goals: season.goals_scored,
      assists: season.assists,
      cleanSheets: season.clean_sheets,
      goalsConceded: season.goals_conceded,
      saves: season.saves,
      bonus: season.bonus,
      involvements: season.goals_scored + season.assists,
      totalPoints: season.total_points,
    }));
}

export interface PointsBreakdown {
  cleanSheetPoints: number;
  goalPoints: number;
  assistPoints: number;
  bonusPoints: number;
  appearancePoints: number;
  estimatedMatches: number;
  estimatedTotal: number;
  actualTotal: number;
}

// Official classic-scoring point values. Clean sheets and goals are worth
// different amounts by position; assists and bonus are position-independent.
const CLEAN_SHEET_POINTS: Record<string, number> = { GKP: 6, DEF: 6, MID: 1, FWD: 0 };
const GOAL_POINTS: Record<string, number> = { GKP: 10, DEF: 6, MID: 5, FWD: 4 };
const ASSIST_POINTS = 3;
const POINTS_PER_APPEARANCE = 2;

// Estimates how a season's real total splits across scoring categories.
// This is necessarily approximate — history_past gives season totals, not
// per-match logs, so "appearances" is inferred as minutes / 90 (rounded)
// rather than actual 60+-minute appearances, and categories FPL scores but
// doesn't expose here (goalkeeper save points, cards, own goals, penalty
// events) aren't included. estimatedTotal is shown alongside the real
// actualTotal specifically so that gap stays visible rather than implied
// away.
export function estimatePointsBreakdown(position: string, season: FplSeasonRow): PointsBreakdown {
  const normalizedPosition = position.toUpperCase();
  const cleanSheetPoints = (CLEAN_SHEET_POINTS[normalizedPosition] ?? 0) * season.cleanSheets;
  const goalPoints = (GOAL_POINTS[normalizedPosition] ?? GOAL_POINTS.FWD) * season.goals;
  const assistPoints = ASSIST_POINTS * season.assists;
  const bonusPoints = season.bonus;
  const estimatedMatches = Math.round(season.minutes / 90);
  const appearancePoints = estimatedMatches * POINTS_PER_APPEARANCE;

  return {
    cleanSheetPoints,
    goalPoints,
    assistPoints,
    bonusPoints,
    appearancePoints,
    estimatedMatches,
    estimatedTotal: cleanSheetPoints + goalPoints + assistPoints + bonusPoints + appearancePoints,
    actualTotal: season.totalPoints,
  };
}
