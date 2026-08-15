import { readFile } from "node:fs/promises";
import path from "node:path";

export interface SeasonStat {
  team: string;
  position: string;
  appearances: number;
  minutes: number;
  rating: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  earlyGoals: number;
  earlyAssists: number;
  lateGoals: number;
  lateAssists: number;
}

export interface DigestPlayer {
  playerId: number;
  name: string;
  nationality: string;
  position: string;
  teamName: string;
  bySeason: Record<string, SeasonStat>;
  totalMinutes: number;
  totalGoalsAssists: number;
  currentPrice: number | null;
  currentForm: number | null;
  fplWebName: string | null;
}

export interface FootballDigest {
  generatedAt: string;
  leagueId: number;
  seasons: number[];
  earlyRounds: number[];
  lateRounds: number[];
  totalPlayersConsidered: number;
  playersInDigest: number;
  players: DigestPlayer[];
}

const DIGEST_PATH = path.join(process.cwd(), "data", "football", "digest.json");

export async function loadFootballDigest(): Promise<FootballDigest | null> {
  try {
    const raw = await readFile(DIGEST_PATH, "utf8");
    return JSON.parse(raw) as FootballDigest;
  } catch {
    return null;
  }
}

// Renders the digest as a compact, LLM-friendly table rather than raw JSON —
// keeps the prompt focused and easy for Claude to scan row by row.
export function formatDigestForPrompt(digest: FootballDigest): string {
  const header =
    "name | position | team | price | 2023(G/A/min/early-G-A/late-G-A) | 2024(...) | 2025(...)";

  const rows = digest.players.map((player) => {
    const seasonCell = (season: number) => {
      const s = player.bySeason[String(season)];
      if (!s) return "-";
      return `${s.goals}G/${s.assists}A/${s.minutes}min/early:${s.earlyGoals}G+${s.earlyAssists}A/late:${s.lateGoals}G+${s.lateAssists}A`;
    };

    const price = player.currentPrice != null ? `£${player.currentPrice}m` : "unknown";

    return [
      player.name,
      player.position,
      player.teamName,
      price,
      seasonCell(2023),
      seasonCell(2024),
      seasonCell(2025),
    ].join(" | ");
  });

  return [header, ...rows].join("\n");
}

function normalizeKey(name: string): string {
  return name.toLowerCase().trim();
}

// Keyed by FPL's own web_name (e.g. "Salah", "Haaland") — the exact string
// squads elsewhere in the app already use, so this is a direct, reliable
// join rather than fuzzy name matching against API-Football's naming.
export function buildFplNameLookup(digest: FootballDigest): Map<string, DigestPlayer> {
  const lookup = new Map<string, DigestPlayer>();
  for (const player of digest.players) {
    if (player.fplWebName) lookup.set(normalizeKey(player.fplWebName), player);
  }
  return lookup;
}

export interface TrendAssessment {
  direction: "rising" | "declining" | "stable";
  latestSeason: number | null;
  previousSeason: number | null;
  latestOutput: number | null;
  previousOutput: number | null;
}

// Same shape as TrendAssessment plus "unknown" — for call sites (a single
// player looked up by name) where there may be no digest match at all,
// which is a distinct case from "matched but not enough seasons to say".
export interface PlayerTrend {
  direction: "rising" | "declining" | "stable" | "unknown";
  latestSeason: number | null;
  previousSeason: number | null;
  latestOutput: number | null;
  previousOutput: number | null;
}

const RECENCY_ORDER = [2025, 2024, 2023];
const TREND_THRESHOLD = 3; // combined goals+assists swing needed to call a direction

function seasonOutput(stat: SeasonStat | undefined): number | null {
  return stat ? stat.goals + stat.assists : null;
}

// Compares a player's two most recent seasons on record (not necessarily
// consecutive calendar years, since some players miss a season) to classify
// whether their output is rising, declining, or roughly stable.
export function classifyTrend(player: DigestPlayer): TrendAssessment {
  const seasonsWithData = RECENCY_ORDER.filter((season) => player.bySeason[String(season)]);

  if (seasonsWithData.length < 2) {
    return {
      direction: "stable",
      latestSeason: seasonsWithData[0] ?? null,
      previousSeason: null,
      latestOutput: seasonOutput(player.bySeason[String(seasonsWithData[0])]),
      previousOutput: null,
    };
  }

  const [latestSeason, previousSeason] = seasonsWithData;
  const latestOutput = seasonOutput(player.bySeason[String(latestSeason)]);
  const previousOutput = seasonOutput(player.bySeason[String(previousSeason)]);
  const diff = (latestOutput ?? 0) - (previousOutput ?? 0);

  const direction: TrendAssessment["direction"] =
    diff >= TREND_THRESHOLD ? "rising" : diff <= -TREND_THRESHOLD ? "declining" : "stable";

  return { direction, latestSeason, previousSeason, latestOutput, previousOutput };
}

export interface MinutesTrend {
  direction: "increasing" | "decreasing" | "stable" | "unknown";
  latestSeason: number | null;
  previousSeason: number | null;
  latestMinutes: number | null;
  previousMinutes: number | null;
}

const MINUTES_TREND_THRESHOLD = 180; // ~2 full matches swing needed to call a direction

// Same two-most-recent-seasons comparison as classifyTrend, but for minutes
// played — a classic FPL signal independent of returns (a player can keep
// scoring at the same rate while quietly losing his starting spot).
export function classifyMinutesTrend(player: DigestPlayer): MinutesTrend {
  const seasonsWithData = RECENCY_ORDER.filter((season) => player.bySeason[String(season)]);

  if (seasonsWithData.length < 2) {
    const onlySeason = seasonsWithData[0];
    return {
      direction: "unknown",
      latestSeason: onlySeason ?? null,
      previousSeason: null,
      latestMinutes: onlySeason != null ? player.bySeason[String(onlySeason)].minutes : null,
      previousMinutes: null,
    };
  }

  const [latestSeason, previousSeason] = seasonsWithData;
  const latestMinutes = player.bySeason[String(latestSeason)].minutes;
  const previousMinutes = player.bySeason[String(previousSeason)].minutes;
  const diff = latestMinutes - previousMinutes;

  const direction: MinutesTrend["direction"] =
    diff >= MINUTES_TREND_THRESHOLD
      ? "increasing"
      : diff <= -MINUTES_TREND_THRESHOLD
        ? "decreasing"
        : "stable";

  return { direction, latestSeason, previousSeason, latestMinutes, previousMinutes };
}

export interface SeasonBreakdownRow {
  season: number;
  goals: number;
  assists: number;
  minutes: number;
  involvements: number;
}

// The player's season-by-season line, oldest first, for a "last 3 seasons"
// table — only seasons the player actually has data for are included.
export function getSeasonBreakdown(player: DigestPlayer): SeasonBreakdownRow[] {
  return [...RECENCY_ORDER]
    .sort((a, b) => a - b)
    .filter((season) => player.bySeason[String(season)])
    .map((season) => {
      const stat = player.bySeason[String(season)];
      return {
        season,
        goals: stat.goals,
        assists: stat.assists,
        minutes: stat.minutes,
        involvements: stat.goals + stat.assists,
      };
    });
}

export interface RisingCandidate extends DigestPlayer {
  trend: TrendAssessment;
}

// League-wide players (excluding anyone already in the user's squad) whose
// output is trending upward — the pool worth surfacing as transfer targets.
export function findRisingCandidates(
  digest: FootballDigest,
  excludeWebNames: Set<string>,
  limit = 25,
): RisingCandidate[] {
  return digest.players
    .filter((player) => {
      if (!player.fplWebName) return false;
      if (excludeWebNames.has(normalizeKey(player.fplWebName))) return false;
      return player.currentPrice != null;
    })
    .map((player) => ({ ...player, trend: classifyTrend(player) }))
    .filter((player) => player.trend.direction === "rising")
    .sort((a, b) => {
      const aImprovement = (a.trend.latestOutput ?? 0) - (a.trend.previousOutput ?? 0);
      const bImprovement = (b.trend.latestOutput ?? 0) - (b.trend.previousOutput ?? 0);
      return bImprovement - aImprovement;
    })
    .slice(0, limit);
}

// One line of prompt text describing a player's trend, e.g.
// "Salah (MID, Liverpool) — 2024: 47 G+A, 2025: 14 G+A (declining)"
export function formatTrendLine(player: DigestPlayer, trend: TrendAssessment, price?: number | null): string {
  const priceText = price != null ? `£${price}m, ` : "";
  const seasonsText =
    trend.previousSeason != null && trend.latestSeason != null
      ? `${trend.previousSeason}: ${trend.previousOutput} G+A, ${trend.latestSeason}: ${trend.latestOutput} G+A`
      : "insufficient season history";

  return `${player.fplWebName ?? player.name} (${player.position}, ${player.teamName}) — ${priceText}${seasonsText} (${trend.direction})`;
}
