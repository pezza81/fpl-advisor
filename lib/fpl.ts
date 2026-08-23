const FPL_BASE_URL = "https://fantasy.premierleague.com/api";

export interface FplTeam {
  id: number;
  name: string;
  short_name: string;
  played: number;
}

export interface FplElementType {
  id: number;
  singular_name_short: string;
  singular_name: string;
}

export interface FplEvent {
  id: number;
  deadline_time: string;
  is_previous: boolean;
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
  average_entry_score: number;
  most_captained: number | null;
  most_vice_captained: number | null;
  most_transferred_in: number | null;
  most_selected: number | null;
  top_element: number | null;
  top_element_info: { id: number; points: number } | null;
  chip_plays: { chip_name: string; num_played: number }[];
}

export interface FplChip {
  name: string; // "wildcard" | "freehit" | "bboost" | "3xc"
  start_event: number;
  stop_event: number;
}

export interface FplElement {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  element_type: number;
  now_cost: number;
  form: string;
  total_points: number;
  selected_by_percent: string;
  status: string;
  news: string;
  transfers_in_event: number;
  transfers_out_event: number;
  cost_change_event: number;
}

export interface BootstrapStatic {
  elements: FplElement[];
  teams: FplTeam[];
  element_types: FplElementType[];
  events: FplEvent[];
  chips: FplChip[];
}

export interface FplPick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface PicksResponse {
  picks: FplPick[];
  entry_history: {
    event: number;
    points: number;
    total_points: number;
    overall_rank: number;
    bank: number;
    value: number;
  };
}

export interface FplClassicLeagueMembership {
  id: number;
  name: string;
  short_name: string | null;
  // "s" = FPL-system-generated (Overall, per-team, per-region, per-gameweek,
  // top-1%/top-10%, broadcast-partner leagues like Sky Sports/TNT/Viaplay —
  // verified against real accounts, not just "Overall" or a naming pattern).
  // "x" = a genuine private/invitational mini-league a manager joined by code.
  league_type: string;
}

export interface EntryResponse {
  id: number;
  player_first_name: string;
  player_last_name: string;
  name: string;
  // Both are null before the entry has completed a gameweek — most notably
  // pre-season, when the fixture calendar hasn't started yet.
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  leagues: {
    classic: FplClassicLeagueMembership[];
  };
}

export interface PrivateLeague {
  id: string;
  name: string;
}

// The manager's own private mini-leagues, filtering out every FPL-generated
// system league. league_type is the reliable signal for this (see
// FplClassicLeagueMembership) — checked against several real accounts, name
// or id-based heuristics ("Overall", "S1...", large ids) would have missed
// system leagues like "Sky Sports League" or "Top 10% 25/26 League".
export function getPrivateLeagues(entry: EntryResponse): PrivateLeague[] {
  return entry.leagues.classic
    .filter((league) => league.league_type !== "s")
    .map((league) => ({ id: String(league.id), name: league.name }));
}

export interface SquadPlayer {
  id: number;
  name: string;
  position: string;
  club: string;
  form: number;
  price: number;
  totalPoints: number;
  selectedByPercent: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isStarting: boolean;
  status: string;
  news: string;
  // EARLY_SEASON: gameweeks 1-4, not injured/suspended — form is too noisy
  // this early to call a sell, so this is a deliberately neutral "not
  // enough data yet" state rather than an endorsement either way.
  flag: "KEEP" | "SELL" | "EARLY_SEASON";
  // In tenths of £m, matching `price`'s own raw unit (e.g. 1 = +£0.1m) —
  // FPL's own running total of this player's price movement so far this
  // gameweek, used as the daily briefing's price-change signal.
  costChangeEvent: number;
  transfersOutEvent: number;
}

export function flagLabel(flag: SquadPlayer["flag"]): string {
  if (flag === "EARLY_SEASON") return "Early season";
  return flag;
}

export function flagBadgeClasses(flag: SquadPlayer["flag"]): string {
  if (flag === "KEEP") return "bg-accent/15 text-accent";
  if (flag === "SELL") return "bg-red-500/15 text-red-400";
  return "bg-sky-500/15 text-sky-300";
}

export interface TeamData {
  teamId: string;
  gameweek: number;
  managerName: string;
  teamName: string;
  overallPoints: number;
  overallRank: number;
  bank: number;
  squadValue: number;
  squad: SquadPlayer[];
  isDemo?: boolean;
  // False when the FPL picks endpoint has no gameweek squad to return yet
  // (typically pre-season) — squad/gameweek/bank/squadValue are then
  // placeholder zero values and callers should show a "check back once the
  // season starts" state instead of the squad grid.
  seasonStarted: boolean;
}

async function fplFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${FPL_BASE_URL}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`FPL API request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

export function fetchBootstrapStatic(): Promise<BootstrapStatic> {
  return fplFetch<BootstrapStatic>("/bootstrap-static/");
}

export function fetchEntry(teamId: string | number): Promise<EntryResponse> {
  return fplFetch<EntryResponse>(`/entry/${teamId}/`);
}

export function fetchPicks(
  teamId: string | number,
  gameweek: number,
): Promise<PicksResponse> {
  return fplFetch<PicksResponse>(`/entry/${teamId}/event/${gameweek}/picks/`);
}

export interface GameweekHistoryRow {
  event: number;
  points: number;
  totalPoints: number;
  overallRank: number;
  pointsOnBench: number;
}

export interface EntryHistoryChip {
  name: string;
  event: number;
}

export interface EntryHistory {
  gameweeks: GameweekHistoryRow[];
  chipsUsed: EntryHistoryChip[];
}

interface RawEntryHistoryResponse {
  current: {
    event: number;
    points: number;
    total_points: number;
    overall_rank: number;
    points_on_bench: number;
  }[];
  chips: { name: string; event: number }[];
}

// The full gameweek-by-gameweek record for this season (points, rank, bench
// points per event) plus which chips have been played and when — the raw
// material for the dashboard's season story and chip-reminder panel. Empty
// arrays are the normal, expected shape before the season has any results.
export async function fetchEntryHistory(teamId: string | number): Promise<EntryHistory> {
  const raw = await fplFetch<RawEntryHistoryResponse>(`/entry/${teamId}/history/`);
  return {
    gameweeks: raw.current.map((row) => ({
      event: row.event,
      points: row.points,
      totalPoints: row.total_points,
      overallRank: row.overall_rank,
      pointsOnBench: row.points_on_bench,
    })),
    chipsUsed: raw.chips.map((chip) => ({ name: chip.name, event: chip.event })),
  };
}

export interface LeagueStandingRow {
  entry: number;
  entryName: string;
  managerName: string;
  rank: number;
  lastRank: number;
  total: number;
  eventTotal: number;
}

export interface LeagueStandings {
  leagueName: string;
  hasMore: boolean;
  rows: LeagueStandingRow[];
}

interface RawLeagueStandingsResponse {
  league: { name: string };
  standings: {
    has_next: boolean;
    results: {
      entry: number;
      entry_name: string;
      player_name: string;
      rank: number;
      last_rank: number;
      total: number;
      event_total: number;
    }[];
  };
}

// Classic mini-league standings, one page at a time (FPL's own default page
// size, 50 entries) — the source for the /league table. Legitimately empty
// before a season has any completed gameweeks, not an error case.
export async function fetchLeagueStandings(
  leagueId: string | number,
  page = 1,
): Promise<LeagueStandings> {
  const raw = await fplFetch<RawLeagueStandingsResponse>(
    `/leagues-classic/${leagueId}/standings/?page_standings=${page}`,
  );

  return {
    leagueName: raw.league.name,
    hasMore: raw.standings.has_next,
    rows: raw.standings.results.map((row) => ({
      entry: row.entry,
      entryName: row.entry_name,
      managerName: row.player_name,
      rank: row.rank,
      lastRank: row.last_rank,
      total: row.total,
      eventTotal: row.event_total,
    })),
  };
}

export function getCurrentGameweek(bootstrap: BootstrapStatic): number {
  const current = bootstrap.events.find((event) => event.is_current);
  if (current) return current.id;
  const next = bootstrap.events.find((event) => event.is_next);
  if (next) return Math.max(1, next.id - 1);
  const lastFinished = [...bootstrap.events]
    .reverse()
    .find((event) => event.finished);
  return lastFinished?.id ?? 1;
}

// Gameweeks 1-4: a player's `form` (average points over recent matches) is
// still mostly noise this early — one blank or one haul swings it wildly —
// so a low-form sell call isn't trustworthy yet. Only a confirmed injury
// ('i') or suspension ('s') is treated as a real signal in that window;
// everything else (including "doubtful") gets a neutral EARLY_SEASON flag.
export const EARLY_SEASON_CUTOFF_GAMEWEEK = 4;
const CONFIRMED_UNAVAILABLE_STATUSES = new Set(["i", "s"]);

function computeFlag(status: string, form: number, gameweek: number): SquadPlayer["flag"] {
  if (CONFIRMED_UNAVAILABLE_STATUSES.has(status)) return "SELL";
  if (gameweek <= EARLY_SEASON_CUTOFF_GAMEWEEK) return "EARLY_SEASON";

  const isUnavailable = status !== "a";
  return isUnavailable || form < 2 ? "SELL" : "KEEP";
}

// Shared per-element mapping used by both buildSquad (a user's 15 picks) and
// buildAllPlayers (every player in the game) — everything except the
// squad-relative fields (captain/vice-captain/starting XI), which only make
// sense in the context of one manager's picks.
function mapElementFields(
  element: FplElement,
  teamsById: Map<number, FplTeam>,
  typesById: Map<number, FplElementType>,
  gameweek: number,
): Omit<SquadPlayer, "isCaptain" | "isViceCaptain" | "isStarting"> {
  const form = Number.parseFloat(element.form) || 0;

  return {
    id: element.id,
    name: element.web_name,
    position: typesById.get(element.element_type)?.singular_name_short ?? "?",
    club: teamsById.get(element.team)?.short_name ?? "?",
    form,
    price: element.now_cost / 10,
    totalPoints: element.total_points,
    selectedByPercent: Number.parseFloat(element.selected_by_percent) || 0,
    status: element.status,
    news: element.news,
    flag: computeFlag(element.status, form, gameweek),
    costChangeEvent: element.cost_change_event,
    transfersOutEvent: element.transfers_out_event,
  };
}

export function buildSquad(
  picks: FplPick[],
  bootstrap: BootstrapStatic,
): SquadPlayer[] {
  const teamsById = new Map(bootstrap.teams.map((team) => [team.id, team]));
  const typesById = new Map(
    bootstrap.element_types.map((type) => [type.id, type]),
  );
  const elementsById = new Map(
    bootstrap.elements.map((element) => [element.id, element]),
  );
  const gameweek = getCurrentGameweek(bootstrap);

  return picks
    .map((pick): SquadPlayer | null => {
      const element = elementsById.get(pick.element);
      if (!element) return null;

      return {
        ...mapElementFields(element, teamsById, typesById, gameweek),
        isCaptain: pick.is_captain,
        isViceCaptain: pick.is_vice_captain,
        isStarting: pick.position <= 11,
      };
    })
    .filter((player): player is SquadPlayer => player !== null)
    .sort((a, b) => a.id - b.id)
    .sort((a, b) => Number(b.isStarting) - Number(a.isStarting));
}

// Every player in the game, not scoped to any one manager's squad — used by
// the /players browser page. Captain/vice-captain/starting don't apply
// outside a squad context, so they're fixed to sensible defaults.
export function buildAllPlayers(bootstrap: BootstrapStatic): SquadPlayer[] {
  const teamsById = new Map(bootstrap.teams.map((team) => [team.id, team]));
  const typesById = new Map(
    bootstrap.element_types.map((type) => [type.id, type]),
  );
  const gameweek = getCurrentGameweek(bootstrap);

  return bootstrap.elements.map((element) => ({
    ...mapElementFields(element, teamsById, typesById, gameweek),
    isCaptain: false,
    isViceCaptain: false,
    isStarting: true,
  }));
}

export const DEMO_TEAM_ID = "demo";

// The demo league (see /league/demo) references several synthetic manager
// ids ("demo1".."demo6") so each row's "expand squad" can resolve through
// the same /api/team code path as a real numeric id — all of them return
// the same fabricated squad below, since the point is demonstrating the
// interaction, not unique data per fake manager.
export function isDemoTeamId(teamId: string): boolean {
  return teamId.toLowerCase().startsWith(DEMO_TEAM_ID);
}

interface DemoPlayerInput {
  // Real FPL element id where the player is still in the current game (used
  // to look up genuine historical per-season data); 0 for the handful who've
  // since left the Premier League and have no current FPL entry to match.
  fplId: number;
  name: string;
  position: string;
  club: string;
  form: number;
  price: number;
  totalPoints: number;
  selectedByPercent: number;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  isStarting: boolean;
  status: string;
  news: string;
}

// A realistic 15-man squad of real Premier League players, used when the
// live FPL season has no picks data yet (e.g. pre-season / before GW1).
const DEMO_SQUAD_INPUT: DemoPlayerInput[] = [
  { fplId: 1, name: "Raya", position: "GKP", club: "ARS", form: 4.2, price: 5.6, totalPoints: 89, selectedByPercent: 22.1, isStarting: true, status: "a", news: "" },
  { fplId: 467, name: "Sels", position: "GKP", club: "NFO", form: 1.5, price: 4.5, totalPoints: 40, selectedByPercent: 3.1, isStarting: false, status: "a", news: "" },
  { fplId: 4, name: "Gabriel", position: "DEF", club: "ARS", form: 5.1, price: 6.2, totalPoints: 102, selectedByPercent: 34.5, isStarting: true, status: "a", news: "" },
  { fplId: 0, name: "Trippier", position: "DEF", club: "NEW", form: 3.8, price: 6.0, totalPoints: 88, selectedByPercent: 12.3, isStarting: true, status: "a", news: "" },
  { fplId: 254, name: "Robinson", position: "DEF", club: "FUL", form: 1.1, price: 4.5, totalPoints: 35, selectedByPercent: 2.0, isStarting: true, status: "d", news: "Knock - 75% chance of playing" },
  { fplId: 233, name: "Mykolenko", position: "DEF", club: "EVE", form: 2.9, price: 4.4, totalPoints: 60, selectedByPercent: 5.4, isStarting: false, status: "a", news: "" },
  { fplId: 0, name: "Salah", position: "MID", club: "LIV", form: 7.8, price: 13.5, totalPoints: 210, selectedByPercent: 55.2, isCaptain: true, isStarting: true, status: "a", news: "" },
  { fplId: 154, name: "Palmer", position: "MID", club: "CHE", form: 6.5, price: 10.8, totalPoints: 178, selectedByPercent: 40.1, isViceCaptain: true, isStarting: true, status: "a", news: "" },
  { fplId: 12, name: "Saka", position: "MID", club: "ARS", form: 5.9, price: 10.0, totalPoints: 160, selectedByPercent: 38.7, isStarting: true, status: "a", news: "" },
  { fplId: 427, name: "Mbeumo", position: "MID", club: "BRE", form: 4.4, price: 7.9, totalPoints: 140, selectedByPercent: 25.0, isStarting: true, status: "a", news: "" },
  { fplId: 521, name: "Kulusevski", position: "MID", club: "TOT", form: 1.8, price: 6.5, totalPoints: 55, selectedByPercent: 4.2, isStarting: false, status: "i", news: "Hamstring injury - Expected back 20 Sep" },
  { fplId: 411, name: "Haaland", position: "FWD", club: "MCI", form: 8.1, price: 14.8, totalPoints: 220, selectedByPercent: 60.9, isStarting: true, status: "a", news: "" },
  { fplId: 379, name: "Isak", position: "FWD", club: "NEW", form: 5.4, price: 9.0, totalPoints: 150, selectedByPercent: 20.3, isStarting: true, status: "a", news: "" },
  { fplId: 490, name: "Wood", position: "FWD", club: "NFO", form: 1.9, price: 6.4, totalPoints: 70, selectedByPercent: 6.6, isStarting: true, status: "a", news: "" },
  { fplId: 0, name: "Jesus", position: "FWD", club: "ARS", form: 0.5, price: 6.9, totalPoints: 20, selectedByPercent: 1.1, isStarting: false, status: "s", news: "Suspended until 30 Aug" },
];

const DEMO_GAMEWEEK = 3;

// bootstrap is optional and, when supplied, is used only to enrich the
// fabricated demo squad with real live cost-change/transfer-activity numbers
// for the handful of demo players who have a real fplId — keeps the daily
// briefing demo-able with genuine data rather than invented figures.
export function getDemoTeamData(bootstrap?: BootstrapStatic | null): TeamData {
  const elementsById = new Map(bootstrap?.elements.map((element) => [element.id, element]) ?? []);

  const squad: SquadPlayer[] = DEMO_SQUAD_INPUT.map((player, index) => {
    const liveElement = player.fplId > 0 ? elementsById.get(player.fplId) : undefined;

    return {
      // Real FPL id where we have one (so per-player history lookups work);
      // otherwise a sentinel well outside FPL's id range (~1-800 today).
      id: player.fplId > 0 ? player.fplId : 900000 + index,
      name: player.name,
      position: player.position,
      club: player.club,
      form: player.form,
      price: player.price,
      totalPoints: player.totalPoints,
      selectedByPercent: player.selectedByPercent,
      isCaptain: player.isCaptain ?? false,
      isViceCaptain: player.isViceCaptain ?? false,
      isStarting: player.isStarting,
      status: player.status,
      news: player.news,
      flag: computeFlag(player.status, player.form, DEMO_GAMEWEEK),
      costChangeEvent: liveElement?.cost_change_event ?? 0,
      transfersOutEvent: liveElement?.transfers_out_event ?? 0,
    };
  });

  const squadValue = Math.round(squad.reduce((sum, p) => sum + p.price, 0) * 10) / 10;

  return {
    teamId: DEMO_TEAM_ID,
    gameweek: DEMO_GAMEWEEK,
    managerName: "Demo Manager",
    teamName: "Demo FC",
    overallPoints: 178,
    overallRank: 452301,
    bank: 0.4,
    squadValue,
    squad,
    isDemo: true,
    seasonStarted: true,
  };
}
