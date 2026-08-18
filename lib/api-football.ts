// Server-only: reads process.env.API_FOOTBALL_KEY and makes live network
// calls. Only import the exported *types* from this file in client
// components (e.g. PlayerModal.tsx via `import type`) — never the fetch
// functions themselves.

const API_BASE = "https://v3.football.api-sports.io";
const PREMIER_LEAGUE_ID = 39;

// API-Football labels seasons by their start year (2026 = 2026/27). Bump
// this — and CLUB_TEAM_ID_MAP below — on each season rollover, the same
// manual-maintenance convention already used by scripts/fetch-football-data.mjs.
const CURRENT_SEASON = 2026;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// FPL's 3-letter club codes -> API-Football's own numeric team ids, for the
// 20 clubs in the 2026/27 Premier League. Verified directly against
// GET /teams?league=39&season=2026 — each id is stable across seasons, but
// the *set* of 20 clubs changes on promotion/relegation, so this needs the
// same yearly upkeep as CURRENT_SEASON above.
const CLUB_TEAM_ID_MAP: Record<string, number> = {
  ARS: 42,
  AVL: 66,
  BOU: 35,
  BRE: 55,
  BHA: 51,
  CHE: 49,
  COV: 1346,
  CRY: 52,
  EVE: 45,
  FUL: 36,
  HUL: 64,
  IPS: 57,
  LEE: 63,
  LIV: 40,
  MCI: 50,
  MUN: 33,
  NEW: 34,
  NFO: 65,
  TOT: 47,
  SUN: 746,
};

const TEAM_ID_TO_CLUB = new Map(Object.entries(CLUB_TEAM_ID_MAP).map(([club, id]) => [id, club]));

export function fplClubToApiFootballTeamId(clubShortName: string): number | null {
  return CLUB_TEAM_ID_MAP[clubShortName] ?? null;
}

// --- low-level fetch + 1hr cache --------------------------------------------

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function hasApiErrors(errors: unknown): boolean {
  return Array.isArray(errors)
    ? errors.length > 0
    : Object.keys((errors as Record<string, unknown>) ?? {}).length > 0;
}

// Every call is cached for an hour, keyed on the full request URL — the
// main defense against burning through API-Football's rate limit, since
// several players/clubs share the same underlying league-wide or
// per-fixture request within that window.
async function apiFootballGet<T>(pathname: string, params: Record<string, string | number>): Promise<T> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error("API_FOOTBALL_KEY is not configured on the server.");

  const url = new URL(`${API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const cacheKey = url.toString();

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data as T;

  const res = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  if (!res.ok) {
    throw new Error(`API-Football request failed (${res.status}): ${pathname}`);
  }

  const json = (await res.json()) as { response: T; errors?: unknown };
  if (hasApiErrors(json.errors)) {
    // API-Football signals rate limits (and other errors) as HTTP 200 with
    // a populated `errors` field, not an HTTP error status.
    throw new Error(`API-Football error for ${pathname}: ${JSON.stringify(json.errors)}`);
  }

  cache.set(cacheKey, { data: json.response, expiresAt: Date.now() + CACHE_TTL_MS });
  return json.response;
}

// --- player name matching ---------------------------------------------------
// API-Football and FPL don't share a player id, so injuries/lineups (keyed
// by API-Football's own player name) are matched back to FPL's web_name by
// normalized surname — the same candidate-surname approach used offline in
// scripts/fetch-football-data.mjs, reimplemented here for live requests.

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLeadingInitial(name: string): string {
  return name.replace(/^[a-zà-ÿ]\.\s*/i, "");
}

function nameCandidates(fullName: string): Set<string> {
  const stripped = stripLeadingInitial(fullName);
  const words = normalizeName(stripped).split(" ").filter(Boolean);
  const candidates = new Set<string>([normalizeName(stripped)]);
  if (words.length >= 1) candidates.add(words.at(-1)!);
  if (words.length >= 2) candidates.add(words.slice(-2).join(" "));
  return candidates;
}

function namesMatch(a: string, b: string): boolean {
  const candidatesA = nameCandidates(a);
  for (const candidate of nameCandidates(b)) {
    if (candidatesA.has(candidate)) return true;
  }
  return false;
}

// --- upcoming fixtures -------------------------------------------------------

interface RawFixture {
  fixture: { id: number; date: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
}

interface UpcomingFixture {
  fixtureId: number;
  kickoff: string;
  opponentTeamId: number;
  opponentName: string;
  isHome: boolean;
}

// The next round of Premier League fixtures (10 matches = all 20 teams) —
// cached for an hour like everything else here, and shared by both the
// lineup and head-to-head lookups below.
async function getUpcomingFixturesByTeamId(): Promise<Map<number, UpcomingFixture>> {
  const fixtures = await apiFootballGet<RawFixture[]>("/fixtures", {
    league: PREMIER_LEAGUE_ID,
    season: CURRENT_SEASON,
    next: 10,
  });

  const map = new Map<number, UpcomingFixture>();
  for (const f of fixtures) {
    const { id: fixtureId, date: kickoff } = f.fixture;
    const { home, away } = f.teams;
    map.set(home.id, { fixtureId, kickoff, opponentTeamId: away.id, opponentName: away.name, isHome: true });
    map.set(away.id, { fixtureId, kickoff, opponentTeamId: home.id, opponentName: home.name, isHome: false });
  }
  return map;
}

// --- injuries ------------------------------------------------------------------

export interface InjuryInfo {
  type: string; // API-Football's own label, e.g. "Missing Fixture"
  reason: string; // free text, e.g. "Hamstring injury", "Suspended"
  asOf: string; // ISO date of the fixture this designation is tied to
}

interface RawInjury {
  player: { name: string; type: string; reason: string };
  team: { id: number };
  fixture: { date: string };
}

// League-wide, cached for an hour — every per-player lookup within that
// window reuses this one request instead of hitting the API per player.
async function getInjuriesByClub(): Promise<Map<string, RawInjury[]>> {
  const injuries = await apiFootballGet<RawInjury[]>("/injuries", {
    league: PREMIER_LEAGUE_ID,
    season: CURRENT_SEASON,
  });

  const byClub = new Map<string, RawInjury[]>();
  for (const injury of injuries) {
    const club = TEAM_ID_TO_CLUB.get(injury.team.id);
    if (!club) continue;
    if (!byClub.has(club)) byClub.set(club, []);
    byClub.get(club)!.push(injury);
  }
  return byClub;
}

export async function getInjuryForPlayer(club: string, webName: string): Promise<InjuryInfo | null> {
  const byClub = await getInjuriesByClub();
  const clubInjuries = byClub.get(club);
  if (!clubInjuries) return null;

  // A player can have several designations across the season (one per
  // missed fixture); the most recent is the closest thing to "current
  // status" this fixture-tied endpoint can give.
  const matches = clubInjuries.filter((injury) => namesMatch(injury.player.name, webName));
  if (matches.length === 0) return null;

  const latest = matches.reduce((a, b) => (new Date(a.fixture.date) > new Date(b.fixture.date) ? a : b));
  return { type: latest.player.type, reason: latest.player.reason, asOf: latest.fixture.date };
}

// --- expected lineup -----------------------------------------------------------

export interface LineupStatus {
  status: "starting" | "bench" | "unknown";
  opponentName: string;
  isHome: boolean;
  kickoff: string;
}

interface RawLineupTeam {
  team: { id: number };
  startXI: { player: { name: string } }[];
  substitutes: { player: { name: string } }[];
}

// API-Football only populates a fixture's lineup once the team sheet is
// officially confirmed — normally around an hour before kickoff — so
// `status` legitimately stays "unknown" for most of the week; that's the
// real state of the data, not a bug in this lookup.
export async function getLineupStatusForPlayer(club: string, webName: string): Promise<LineupStatus | null> {
  const teamId = fplClubToApiFootballTeamId(club);
  if (!teamId) return null;

  const fixtures = await getUpcomingFixturesByTeamId();
  const upcoming = fixtures.get(teamId);
  if (!upcoming) return null;

  const lineups = await apiFootballGet<RawLineupTeam[]>("/fixtures/lineups", {
    fixture: upcoming.fixtureId,
  });
  const teamLineup = lineups.find((entry) => entry.team.id === teamId);

  let status: LineupStatus["status"] = "unknown";
  if (teamLineup) {
    if (teamLineup.startXI.some((p) => namesMatch(p.player.name, webName))) status = "starting";
    else if (teamLineup.substitutes.some((p) => namesMatch(p.player.name, webName))) status = "bench";
  }

  return { status, opponentName: upcoming.opponentName, isHome: upcoming.isHome, kickoff: upcoming.kickoff };
}

// --- head-to-head ----------------------------------------------------------------

export interface HeadToHeadSummary {
  opponentName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

interface RawH2HFixture {
  teams: {
    home: { id: number; winner: boolean | null };
    away: { id: number; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
}

export async function getHeadToHeadForClub(club: string): Promise<HeadToHeadSummary | null> {
  const teamId = fplClubToApiFootballTeamId(club);
  if (!teamId) return null;

  const fixtures = await getUpcomingFixturesByTeamId();
  const upcoming = fixtures.get(teamId);
  if (!upcoming) return null;

  const meetings = await apiFootballGet<RawH2HFixture[]>("/fixtures/headtohead", {
    h2h: `${teamId}-${upcoming.opponentTeamId}`,
    last: 5,
  });

  const summary: HeadToHeadSummary = {
    opponentName: upcoming.opponentName,
    played: meetings.length,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
  };

  for (const meeting of meetings) {
    const isHome = meeting.teams.home.id === teamId;
    const ownGoals = (isHome ? meeting.goals.home : meeting.goals.away) ?? 0;
    const oppGoals = (isHome ? meeting.goals.away : meeting.goals.home) ?? 0;
    summary.goalsFor += ownGoals;
    summary.goalsAgainst += oppGoals;

    const ownWinner = isHome ? meeting.teams.home.winner : meeting.teams.away.winner;
    if (ownWinner === true) summary.wins += 1;
    else if (ownWinner === false) summary.losses += 1;
    else summary.draws += 1;
  }

  return summary;
}

// --- bulk cache warming ------------------------------------------------------------

// Pre-populates the two shared, league-wide caches (injuries, upcoming
// fixtures) so a bulk caller — e.g. building advice for a full 15-player
// squad — doesn't fire a burst of duplicate concurrent requests for the
// same underlying data before the first one has a chance to cache it.
export async function preloadMatchContextCache(): Promise<void> {
  await Promise.all([
    getInjuriesByClub().catch(() => undefined),
    getUpcomingFixturesByTeamId().catch(() => undefined),
  ]);
}

// --- combined lookup for the player modal -------------------------------------------

export interface PlayerMatchContext {
  injury: InjuryInfo | null;
  lineup: LineupStatus | null;
  headToHead: HeadToHeadSummary | null;
}

export async function getPlayerMatchContext(club: string, webName: string): Promise<PlayerMatchContext> {
  const [injury, lineup, headToHead] = await Promise.all([
    getInjuryForPlayer(club, webName).catch((error) => {
      console.error("Failed to load injury data", error);
      return null;
    }),
    getLineupStatusForPlayer(club, webName).catch((error) => {
      console.error("Failed to load lineup data", error);
      return null;
    }),
    getHeadToHeadForClub(club).catch((error) => {
      console.error("Failed to load head-to-head data", error);
      return null;
    }),
  ]);

  return { injury, lineup, headToHead };
}
