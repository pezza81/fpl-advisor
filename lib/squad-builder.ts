import type { SquadPlayer } from "./fpl";
import { buildFplNameLookup, classifyTrend, loadFootballDigest } from "./football-trends";
import { fplClubToTeamName, getLeagueStrengthRankings } from "./team-stats";
import { canAddPlayer, computeSquadTotals, POSITION_QUOTAS, SQUAD_BUDGET, SQUAD_SIZE } from "./squad-rules";

export interface ScoredPlayer extends SquadPlayer {
  // Composite "how good is this player" rating in points-ish units —
  // season points plus bonuses/penalties for trend direction, the relevant
  // side of their club's real xG strength, and current form.
  score: number;
  // score per £m spent — what the budget-aware greedy fallback sorts by.
  valueScore: number;
  trendDirection: "rising" | "declining" | "stable" | "unknown";
  relevantRank: number | null; // defense rank for GKP/DEF, attack rank for MID/FWD
  rankTotal: number;
}

const DEFENSIVE_POSITIONS = new Set(["GKP", "DEF"]);

// Combines season output, the 3-season trend digest, and each club's real
// xG-based league strength rank into one score per player. Only players
// currently available ('a') are considered — a squad-building tool
// shouldn't be steering anyone toward an injured or suspended player.
export async function scorePlayers(players: SquadPlayer[]): Promise<ScoredPlayer[]> {
  const digest = await loadFootballDigest();
  const trendLookup = digest ? buildFplNameLookup(digest) : null;

  let rankings: ReturnType<typeof getLeagueStrengthRankings> = [];
  try {
    rankings = getLeagueStrengthRankings();
  } catch (error) {
    console.error("Failed to load team strength rankings for squad builder", error);
  }
  const rankByTeam = new Map(rankings.map((r) => [r.teamName, r]));
  const rankTotal = rankings.length;

  return players
    .filter((player) => player.status === "a")
    .map((player): ScoredPlayer => {
      const digestPlayer = trendLookup?.get(player.name.toLowerCase().trim());
      const trend = digestPlayer ? classifyTrend(digestPlayer) : null;
      const trendDirection = trend?.direction ?? "unknown";
      const trendBonus = trendDirection === "rising" ? 20 : trendDirection === "declining" ? -20 : 0;

      const teamName = fplClubToTeamName(player.club);
      const rank = teamName ? rankByTeam.get(teamName) : undefined;
      const relevantRank = rank
        ? DEFENSIVE_POSITIONS.has(player.position)
          ? rank.defenseRank
          : rank.attackRank
        : null;
      const rankBonus = relevantRank != null ? (rankTotal + 1 - relevantRank) * 1.5 : 0;

      const formBonus = player.form * 3;

      const score = player.totalPoints + trendBonus + rankBonus + formBonus;
      const valueScore = player.price > 0 ? score / player.price : 0;

      return { ...player, score, valueScore, trendDirection, relevantRank, rankTotal };
    });
}

const SHORTLIST_TARGETS: Record<string, { byScore: number; byValue: number; cheapest: number }> = {
  GKP: { byScore: 10, byValue: 8, cheapest: 4 },
  DEF: { byScore: 25, byValue: 15, cheapest: 8 },
  MID: { byScore: 25, byValue: 15, cheapest: 8 },
  FWD: { byScore: 18, byValue: 10, cheapest: 5 },
};

// A compact, budget-diverse candidate pool per position for the Claude
// prompt: top performers by score (the "spine"), top performers by value
// density (efficient picks), and the outright cheapest options (so a
// legal-budget squad is actually reachable from what's shown, not just the
// premiums a pure points ranking would surface).
export function buildShortlist(scored: ScoredPlayer[]): Record<string, ScoredPlayer[]> {
  const byPosition: Record<string, ScoredPlayer[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const player of scored) {
    byPosition[player.position]?.push(player);
  }

  const result: Record<string, ScoredPlayer[]> = {};
  for (const [position, list] of Object.entries(byPosition)) {
    const targets = SHORTLIST_TARGETS[position] ?? { byScore: 20, byValue: 15, cheapest: 6 };
    const merged = new Map<number, ScoredPlayer>();

    for (const p of [...list].sort((a, b) => b.score - a.score).slice(0, targets.byScore)) {
      merged.set(p.id, p);
    }
    for (const p of [...list].sort((a, b) => b.valueScore - a.valueScore).slice(0, targets.byValue)) {
      merged.set(p.id, p);
    }
    for (const p of [...list].sort((a, b) => a.price - b.price).slice(0, targets.cheapest)) {
      merged.set(p.id, p);
    }

    result[position] = Array.from(merged.values()).sort((a, b) => b.score - a.score);
  }
  return result;
}

function minPriceByPosition(candidates: ScoredPlayer[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const position of Object.keys(POSITION_QUOTAS)) {
    const prices = candidates.filter((c) => c.position === position).map((c) => c.price);
    result[position] = prices.length > 0 ? Math.min(...prices) : 0;
  }
  return result;
}

// Deterministic, rules-guaranteed squad builder: greedily takes the best
// value-per-million player available, skipping any pick that would leave
// too little budget to fill the remaining mandatory slots at their cheapest
// available price. Runs over the FULL scored pool (not the Claude
// shortlist) so it always has enough candidates to complete a legal squad —
// this is the safety net behind the "AI suggest" button, used whenever
// Claude's own picks fail validation.
export function greedyBuildSquad(candidates: ScoredPlayer[]): ScoredPlayer[] {
  const squad: ScoredPlayer[] = [];
  const minPrices = minPriceByPosition(candidates);
  const remainingSlots: Record<string, number> = { ...POSITION_QUOTAS };
  const sorted = [...candidates].sort((a, b) => b.valueScore - a.valueScore);

  for (const candidate of sorted) {
    if (squad.length >= SQUAD_SIZE) break;
    if ((remainingSlots[candidate.position] ?? 0) <= 0) continue;
    if (!canAddPlayer(squad, candidate).ok) continue;

    const totals = computeSquadTotals(squad);
    const spentAfter = totals.spent + candidate.price;
    const slotsAfterThisPick = {
      ...remainingSlots,
      [candidate.position]: remainingSlots[candidate.position] - 1,
    };
    const minNeededForRest = Object.entries(slotsAfterThisPick).reduce(
      (sum, [position, count]) => sum + count * (minPrices[position] ?? 0),
      0,
    );

    if (SQUAD_BUDGET - spentAfter < minNeededForRest - 1e-9) continue;

    squad.push(candidate);
    remainingSlots[candidate.position] -= 1;
  }

  return squad;
}
