import type { SquadPlayer } from "./fpl";

export const SQUAD_BUDGET = 100;
export const SQUAD_SIZE = 15;
export const MAX_PER_CLUB = 3;

export const POSITION_QUOTAS: Record<string, number> = {
  GKP: 2,
  DEF: 5,
  MID: 5,
  FWD: 3,
};

export const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"] as const;

export interface SquadTotals {
  spent: number;
  remaining: number;
  positionCounts: Record<string, number>;
  clubCounts: Record<string, number>;
  isComplete: boolean;
}

export function computeSquadTotals(squad: SquadPlayer[]): SquadTotals {
  const positionCounts: Record<string, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const clubCounts: Record<string, number> = {};
  let spent = 0;

  for (const player of squad) {
    spent += player.price;
    positionCounts[player.position] = (positionCounts[player.position] ?? 0) + 1;
    clubCounts[player.club] = (clubCounts[player.club] ?? 0) + 1;
  }

  const isComplete =
    squad.length === SQUAD_SIZE &&
    Object.entries(POSITION_QUOTAS).every(([pos, quota]) => positionCounts[pos] === quota);

  return {
    spent: Math.round(spent * 10) / 10,
    remaining: Math.round((SQUAD_BUDGET - spent) * 10) / 10,
    positionCounts,
    clubCounts,
    isComplete,
  };
}

export interface AdditionCheck {
  ok: boolean;
  reason?: string;
}

// Can `player` be legally added to `squad` under standard FPL squad-building
// rules? Used both to gate the "Add" button in the picker UI and to validate
// Claude's suggested squad server-side before trusting it.
export function canAddPlayer(squad: SquadPlayer[], player: SquadPlayer): AdditionCheck {
  if (squad.some((existing) => existing.id === player.id)) {
    return { ok: false, reason: "Already in your squad." };
  }
  if (squad.length >= SQUAD_SIZE) {
    return { ok: false, reason: "Squad is already full (15 players)." };
  }

  const totals = computeSquadTotals(squad);
  const quota = POSITION_QUOTAS[player.position] ?? 0;
  if ((totals.positionCounts[player.position] ?? 0) >= quota) {
    return { ok: false, reason: `You already have ${quota} ${player.position}.` };
  }

  if ((totals.clubCounts[player.club] ?? 0) >= MAX_PER_CLUB) {
    return { ok: false, reason: `Max ${MAX_PER_CLUB} players from ${player.club}.` };
  }

  if (totals.spent + player.price > SQUAD_BUDGET + 1e-9) {
    return { ok: false, reason: `Not enough budget (£${totals.remaining.toFixed(1)}m left).` };
  }

  return { ok: true };
}

// Full rules check for a complete squad, independent of how it was
// assembled (manual picks or an AI suggestion) — used to validate
// Claude's output before trusting it.
export function isRuleCompliantSquad(squad: SquadPlayer[]): boolean {
  if (squad.length !== SQUAD_SIZE) return false;
  if (new Set(squad.map((p) => p.id)).size !== squad.length) return false;

  const totals = computeSquadTotals(squad);
  if (totals.spent > SQUAD_BUDGET + 1e-9) return false;

  for (const [pos, quota] of Object.entries(POSITION_QUOTAS)) {
    if ((totals.positionCounts[pos] ?? 0) !== quota) return false;
  }
  for (const count of Object.values(totals.clubCounts)) {
    if (count > MAX_PER_CLUB) return false;
  }

  return true;
}
