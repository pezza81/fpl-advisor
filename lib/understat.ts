import { readFile } from "node:fs/promises";
import path from "node:path";

export interface UnderstatPlayer {
  name: string;
  team: string;
  position: string;
  games: number;
  minutes: number;
  goals: number;
  assists: number;
  xG: number;
  xA: number;
  npxG: number;
  shots: number;
  keyPasses: number;
  xG90: number;
  xA90: number;
}

interface UnderstatFile {
  generatedAt: string;
  season: string;
  players: UnderstatPlayer[];
}

const DATA_PATH = path.join(process.cwd(), "data", "understat", "players.json");

// FPL position codes map onto Understat's own single-letter ones for
// getTopXGPlayers's filter — Understat sometimes lists a player under more
// than one ("D M" for a wing-back who also plays midfield), so this checks
// membership rather than an exact match.
const FPL_TO_UNDERSTAT_POSITION: Record<string, string> = {
  GKP: "GK",
  DEF: "D",
  MID: "M",
  FWD: "F",
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// FPL identifies squad players by a short display surname (e.g. "Haaland"),
// while Understat lists full names ("Erling Haaland") — so the lookup index
// is keyed by surname (and last-two-words, for double-barrelled names like
// "Mac Allister" or "Van Dijk") rather than the full name.
function buildNameIndex(players: UnderstatPlayer[]): Map<string, UnderstatPlayer> {
  const index = new Map<string, UnderstatPlayer>();
  for (const player of players) {
    const words = normalizeName(player.name).split(" ").filter(Boolean);
    const candidates = new Set<string>([normalizeName(player.name)]);
    if (words.length >= 1) candidates.add(words[words.length - 1]);
    if (words.length >= 2) candidates.add(words.slice(-2).join(" "));
    for (const candidate of candidates) {
      if (!index.has(candidate)) index.set(candidate, player);
    }
  }
  return index;
}

let cachedPlayers: UnderstatPlayer[] | null | undefined;
let cachedIndex: Map<string, UnderstatPlayer> | null = null;

async function loadPlayers(): Promise<UnderstatPlayer[] | null> {
  if (cachedPlayers !== undefined) return cachedPlayers;
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    const data = JSON.parse(raw) as UnderstatFile;
    cachedPlayers = data.players;
  } catch {
    // Not yet scraped (npm run fetch:understat) — callers degrade gracefully.
    cachedPlayers = null;
  }
  return cachedPlayers;
}

async function getNameIndex(): Promise<Map<string, UnderstatPlayer> | null> {
  const players = await loadPlayers();
  if (!players) return null;
  if (!cachedIndex) cachedIndex = buildNameIndex(players);
  return cachedIndex;
}

export async function getPlayerXG(playerName: string): Promise<UnderstatPlayer | null> {
  const index = await getNameIndex();
  if (!index) return null;
  return index.get(normalizeName(playerName)) ?? null;
}

// `position` accepts FPL's own codes (GKP/DEF/MID/FWD) so callers don't need
// to know Understat's internal single-letter scheme.
export async function getTopXGPlayers(position?: string, limit = 10): Promise<UnderstatPlayer[]> {
  const players = await loadPlayers();
  if (!players) return [];

  const understatCode = position ? FPL_TO_UNDERSTAT_POSITION[position] : undefined;
  const filtered = understatCode
    ? players.filter((player) => player.position.split(" ").includes(understatCode))
    : players;

  return [...filtered].sort((a, b) => b.xG - a.xG).slice(0, limit);
}
