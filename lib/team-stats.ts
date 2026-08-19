import { query } from "./shared-db";

const PREMIER_LEAGUE_ID = 39;

// The shared match database is Sportmonks-sourced and keys teams by full
// name ("Arsenal", "Nottingham Forest"); FPL keys them by 3-letter codes
// ("ARS", "NFO"). This is the stable set of codes seen in the Premier
// League in recent seasons — independent of which 20 happen to be in the
// top flight this year.
const CLUB_NAME_MAP: Record<string, string> = {
  ARS: "Arsenal",
  AVL: "Aston Villa",
  BOU: "Bournemouth",
  BRE: "Brentford",
  BHA: "Brighton",
  BUR: "Burnley",
  CHE: "Chelsea",
  CRY: "Crystal Palace",
  EVE: "Everton",
  FUL: "Fulham",
  IPS: "Ipswich",
  LEE: "Leeds",
  LEI: "Leicester",
  LIV: "Liverpool",
  MCI: "Manchester City",
  MUN: "Manchester United",
  NEW: "Newcastle",
  NFO: "Nottingham Forest",
  SOU: "Southampton",
  SUN: "Sunderland",
  TOT: "Tottenham",
  WHU: "West Ham",
  WOL: "Wolves",
};

export function fplClubToTeamName(clubShortName: string): string | null {
  return CLUB_NAME_MAP[clubShortName] ?? null;
}

interface MatchRow {
  match_date: string;
  home_team: string;
  away_team: string;
  home_xg: number | null;
  away_xg: number | null;
  home_xgot: number | null;
  away_xgot: number | null;
  home_pressure_index: number | null;
  away_pressure_index: number | null;
}

export interface TeamRollingForm {
  teamName: string;
  matchesPlayed: number;
  xgFor: number;
  xgAgainst: number;
  xgotFor: number;
  xgotAgainst: number;
  pressureIndex: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Average xG/xGoT/pressure index over a team's most recent N matches
// (any competition/season present in the shared DB), most recent first.
export function getTeamRollingForm(teamName: string, lastN = 5): TeamRollingForm | null {
  const rows = query<MatchRow>(
    `SELECT match_date, home_team, away_team, home_xg, away_xg, home_xgot, away_xgot,
            home_pressure_index, away_pressure_index
     FROM matches
     WHERE (home_team = ? OR away_team = ?)
       AND home_xg IS NOT NULL AND away_xg IS NOT NULL
     ORDER BY match_date DESC
     LIMIT ?`,
    [teamName, teamName, lastN],
  );

  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (acc, row) => {
      const isHome = row.home_team === teamName;
      acc.xgFor += (isHome ? row.home_xg : row.away_xg) ?? 0;
      acc.xgAgainst += (isHome ? row.away_xg : row.home_xg) ?? 0;
      acc.xgotFor += (isHome ? row.home_xgot : row.away_xgot) ?? 0;
      acc.xgotAgainst += (isHome ? row.away_xgot : row.home_xgot) ?? 0;
      acc.pressureIndex += (isHome ? row.home_pressure_index : row.away_pressure_index) ?? 0;
      return acc;
    },
    { xgFor: 0, xgAgainst: 0, xgotFor: 0, xgotAgainst: 0, pressureIndex: 0 },
  );

  const n = rows.length;
  return {
    teamName,
    matchesPlayed: n,
    xgFor: round2(totals.xgFor / n),
    xgAgainst: round2(totals.xgAgainst / n),
    xgotFor: round2(totals.xgotFor / n),
    xgotAgainst: round2(totals.xgotAgainst / n),
    pressureIndex: round2(totals.pressureIndex / n),
  };
}

// Buckets a team's average xG conceded into an FPL-style 1 (easiest to
// score against) - 5 (hardest) rating. Breakpoints are a heuristic based on
// typical top-five-league xG-against ranges, not a league-relative
// percentile — good enough for "is this fixture tough" framing in advice.
function ratingFromXgAgainst(xgAgainst: number): number {
  if (xgAgainst <= 1.0) return 5;
  if (xgAgainst <= 1.3) return 4;
  if (xgAgainst <= 1.6) return 3;
  if (xgAgainst <= 1.9) return 2;
  return 1;
}

export interface FixtureDifficulty {
  homeTeam: string;
  awayTeam: string;
  homeForm: TeamRollingForm | null;
  awayForm: TeamRollingForm | null;
  // Blend of each side's own attacking rate and the opponent's rate of
  // conceding, as a simple expected-goals projection for this fixture.
  homeExpectedGoals: number | null;
  awayExpectedGoals: number | null;
  // 1 (easy) - 5 (hard) difficulty of scoring, for each side's attackers,
  // driven by the opponent's recent defensive xG record.
  homeAttackDifficulty: number | null;
  awayAttackDifficulty: number | null;
  // homeExpectedGoals + awayExpectedGoals — a rough "how open is this game" signal.
  combinedOpenness: number | null;
}

export function getFixtureDifficulty(
  homeTeam: string,
  awayTeam: string,
  lastN = 5,
): FixtureDifficulty {
  const homeForm = getTeamRollingForm(homeTeam, lastN);
  const awayForm = getTeamRollingForm(awayTeam, lastN);

  const homeExpectedGoals =
    homeForm && awayForm ? round2((homeForm.xgFor + awayForm.xgAgainst) / 2) : null;
  const awayExpectedGoals =
    homeForm && awayForm ? round2((awayForm.xgFor + homeForm.xgAgainst) / 2) : null;

  return {
    homeTeam,
    awayTeam,
    homeForm,
    awayForm,
    homeExpectedGoals,
    awayExpectedGoals,
    homeAttackDifficulty: awayForm ? ratingFromXgAgainst(awayForm.xgAgainst) : null,
    awayAttackDifficulty: homeForm ? ratingFromXgAgainst(homeForm.xgAgainst) : null,
    combinedOpenness:
      homeExpectedGoals !== null && awayExpectedGoals !== null
        ? round2(homeExpectedGoals + awayExpectedGoals)
        : null,
  };
}

// Shared bucket definitions for "days rest before a match" — used both for
// the historical xG-by-rest analysis below and (as a live, current-fixture
// number from lib/api-football.ts) for the player modal's rest-days badge.
// Keep these two call sites' thresholds in sync if this ever changes.
export type RestBucket = "3_or_fewer" | "4_to_5" | "6_or_more";

export const REST_BUCKET_LABELS: Record<RestBucket, string> = {
  "3_or_fewer": "3 days or fewer",
  "4_to_5": "4-5 days",
  "6_or_more": "6+ days",
};

export function restBucketFor(days: number): RestBucket {
  if (days <= 3) return "3_or_fewer";
  if (days <= 5) return "4_to_5";
  return "6_or_more";
}

export interface RestDaysBucketStats {
  bucket: RestBucket;
  label: string;
  matches: number;
  avgXgFor: number;
  avgXgAgainst: number;
}

// A single-day-or-less or absurdly long gap between "consecutive" matches
// almost always means a data gap (season boundary, cup withdrawal) rather
// than a real rest period — excluded so it doesn't skew the 6+ bucket.
const MAX_PLAUSIBLE_REST_DAYS = 21;

// How a team's xG for/against varies with how many days rest they had
// coming into the match (gap since their previous match in the dataset, any
// competition). Uses the full Premier League history in the shared DB
// (every season present, not just the current one) for a decent sample
// size in the rarer short-rest bucket.
export function getRestDaysImpact(teamName: string): RestDaysBucketStats[] {
  const rows = query<Pick<MatchRow, "match_date" | "home_team" | "away_team" | "home_xg" | "away_xg">>(
    `SELECT match_date, home_team, away_team, home_xg, away_xg
     FROM matches
     WHERE league_id = ? AND (home_team = ? OR away_team = ?)
       AND home_xg IS NOT NULL AND away_xg IS NOT NULL
     ORDER BY match_date ASC`,
    [PREMIER_LEAGUE_ID, teamName, teamName],
  );

  const totals: Record<RestBucket, { xgFor: number; xgAgainst: number; matches: number }> = {
    "3_or_fewer": { xgFor: 0, xgAgainst: 0, matches: 0 },
    "4_to_5": { xgFor: 0, xgAgainst: 0, matches: 0 },
    "6_or_more": { xgFor: 0, xgAgainst: 0, matches: 0 },
  };

  let previousDate: Date | null = null;
  for (const row of rows) {
    const matchDate = new Date(row.match_date);
    if (previousDate) {
      const restDays = Math.round(
        (matchDate.getTime() - previousDate.getTime()) / (24 * 60 * 60 * 1000),
      );
      if (restDays > 0 && restDays <= MAX_PLAUSIBLE_REST_DAYS) {
        const bucket = restBucketFor(restDays);
        const isHome = row.home_team === teamName;
        totals[bucket].xgFor += (isHome ? row.home_xg : row.away_xg) ?? 0;
        totals[bucket].xgAgainst += (isHome ? row.away_xg : row.home_xg) ?? 0;
        totals[bucket].matches += 1;
      }
    }
    previousDate = matchDate;
  }

  return (Object.keys(totals) as RestBucket[]).map((bucket) => {
    const { xgFor, xgAgainst, matches } = totals[bucket];
    return {
      bucket,
      label: REST_BUCKET_LABELS[bucket],
      matches,
      avgXgFor: matches > 0 ? round2(xgFor / matches) : 0,
      avgXgAgainst: matches > 0 ? round2(xgAgainst / matches) : 0,
    };
  });
}

export interface TeamStrengthRanking {
  teamName: string;
  matchesPlayed: number;
  avgXgFor: number;
  avgXgAgainst: number;
  attackRank: number; // 1 = best attack (highest average xG created)
  defenseRank: number; // 1 = best defense (lowest average xG conceded)
}

// The season with the most recent match in the DB for this league — the
// shared scraper labels seasons by start year ("2025" = 2025/26), and this
// avoids hardcoding a season string that goes stale as new data lands.
function getCurrentSeason(leagueId: number): string | null {
  const row = query<{ season: string }>(
    `SELECT season FROM matches WHERE league_id = ? ORDER BY match_date DESC LIMIT 1`,
    [leagueId],
  )[0];
  return row?.season ?? null;
}

export function getLeagueStrengthRankings(season?: string): TeamStrengthRanking[] {
  const targetSeason = season ?? getCurrentSeason(PREMIER_LEAGUE_ID);
  if (!targetSeason) return [];

  const rows = query<MatchRow>(
    `SELECT match_date, home_team, away_team, home_xg, away_xg, home_xgot, away_xgot,
            home_pressure_index, away_pressure_index
     FROM matches
     WHERE league_id = ? AND season = ? AND home_xg IS NOT NULL AND away_xg IS NOT NULL`,
    [PREMIER_LEAGUE_ID, targetSeason],
  );

  const byTeam = new Map<string, { xgFor: number; xgAgainst: number; matches: number }>();

  function add(team: string, xgFor: number, xgAgainst: number) {
    const entry = byTeam.get(team) ?? { xgFor: 0, xgAgainst: 0, matches: 0 };
    entry.xgFor += xgFor;
    entry.xgAgainst += xgAgainst;
    entry.matches += 1;
    byTeam.set(team, entry);
  }

  for (const row of rows) {
    add(row.home_team, row.home_xg ?? 0, row.away_xg ?? 0);
    add(row.away_team, row.away_xg ?? 0, row.home_xg ?? 0);
  }

  const teams = Array.from(byTeam.entries()).map(([teamName, stats]) => ({
    teamName,
    matchesPlayed: stats.matches,
    avgXgFor: round2(stats.xgFor / stats.matches),
    avgXgAgainst: round2(stats.xgAgainst / stats.matches),
  }));

  const attackRankByTeam = new Map(
    [...teams].sort((a, b) => b.avgXgFor - a.avgXgFor).map((t, i) => [t.teamName, i + 1]),
  );
  const defenseRankByTeam = new Map(
    [...teams].sort((a, b) => a.avgXgAgainst - b.avgXgAgainst).map((t, i) => [t.teamName, i + 1]),
  );

  return teams
    .map((team) => ({
      ...team,
      attackRank: attackRankByTeam.get(team.teamName)!,
      defenseRank: defenseRankByTeam.get(team.teamName)!,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}
