import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_TEAM_ID,
  buildSquad,
  fetchBootstrapStatic,
  fetchEntry,
  fetchEntryHistory,
  fetchPicks,
  fetchTransferHistory,
  getCurrentGameweek,
  getDemoTeamData,
  getPrivateLeagues,
  type BootstrapStatic,
  type EntryHistoryChip,
  type FplChip,
  type FplElement,
  type FplEvent,
  type GameweekHistoryRow,
  type SquadPlayer,
  type TransferRecord,
} from "@/lib/fpl";
import { buildFplNameLookup, classifyTrend, loadFootballDigest } from "@/lib/football-trends";
import {
  getClubRestDays,
  getInjuryForPlayer,
  getLineupStatusForPlayer,
  preloadMatchContextCache,
} from "@/lib/api-football";
import { CHIP_LABELS } from "@/lib/chips";
import type {
  ChipStatus,
  DashboardData,
  DashboardLeague,
  SeasonHistoryRow,
  SquadHealthPlayer,
  TransferHistoryEntry,
  UpcomingChanges,
  WhatsHappeningTile,
} from "@/lib/dashboard-types";

// A chip counts as "available" if the current gameweek falls inside one of
// its windows (each chip type gets two windows a season, first/second half)
// and hasn't already been played within that specific window.
function computeChipStatus(
  bootstrapChips: FplChip[],
  usedChips: EntryHistoryChip[],
  currentGameweek: number,
): ChipStatus[] {
  const byName = new Map<string, ChipStatus>();

  for (const window of bootstrapChips) {
    if (currentGameweek < window.start_event || currentGameweek > window.stop_event) continue;

    const usedInWindow = usedChips.some(
      (used) =>
        used.name === window.name &&
        used.event >= window.start_event &&
        used.event <= window.stop_event,
    );

    byName.set(window.name, {
      name: window.name,
      label: CHIP_LABELS[window.name] ?? window.name,
      available: !usedInWindow,
    });
  }

  return Array.from(byName.values());
}

// FPL exposes an official "most transferred in" field on the current event,
// but has no equivalent "most transferred out" — so that one tile is derived
// by sorting elements ourselves, and is labelled as our own read of the data
// rather than an official FPL ranking.
function buildWhatsHappening(bootstrap: BootstrapStatic): WhatsHappeningTile[] {
  const currentEvent =
    bootstrap.events.find((event) => event.is_current) ??
    bootstrap.events.find((event) => event.is_previous);
  if (!currentEvent) return [];

  const elementById = new Map(bootstrap.elements.map((element) => [element.id, element]));
  const tiles: WhatsHappeningTile[] = [];

  const captainPick = currentEvent.most_captained != null ? elementById.get(currentEvent.most_captained) : undefined;
  if (captainPick) {
    tiles.push({
      label: "Most captained",
      value: captainPick.web_name,
      context: `${captainPick.selected_by_percent}% of managers own ${captainPick.web_name} this week — is your captain a rarer pick?`,
    });
  }

  const transferredInPick =
    currentEvent.most_transferred_in != null ? elementById.get(currentEvent.most_transferred_in) : undefined;
  if (transferredInPick) {
    tiles.push({
      label: "Most transferred in",
      value: transferredInPick.web_name,
      context: `${transferredInPick.transfers_in_event.toLocaleString()} managers have brought in ${transferredInPick.web_name} this gameweek.`,
    });
  }

  const transferredOutPick = [...bootstrap.elements].sort(
    (a, b) => b.transfers_out_event - a.transfers_out_event,
  )[0];
  if (transferredOutPick && transferredOutPick.transfers_out_event > 0) {
    tiles.push({
      label: "Most transferred out",
      value: transferredOutPick.web_name,
      context: `${transferredOutPick.transfers_out_event.toLocaleString()} managers have sold ${transferredOutPick.web_name} this gameweek.`,
    });
  }

  const topChip = [...(currentEvent.chip_plays ?? [])].sort((a, b) => b.num_played - a.num_played)[0];
  if (topChip) {
    const label = CHIP_LABELS[topChip.chip_name] ?? topChip.chip_name;
    tiles.push({
      label: "Most-played chip",
      value: label,
      context: `${topChip.num_played.toLocaleString()} managers have played ${label} this gameweek.`,
    });
  }

  return tiles;
}

// Joins this manager's gameweek-by-gameweek record with the league-wide
// average score for each of those gameweeks (from bootstrap events) — the
// season story chart plots both on the same points axis.
function buildSeasonHistory(
  gameweeks: GameweekHistoryRow[],
  events: FplEvent[],
): SeasonHistoryRow[] {
  const averageByEvent = new Map(events.map((event) => [event.id, event.average_entry_score]));
  return [...gameweeks]
    .sort((a, b) => a.event - b.event)
    .map((row) => ({
      event: row.event,
      points: row.points,
      totalPoints: row.totalPoints,
      overallRank: row.overallRank,
      pointsOnBench: row.pointsOnBench,
      average: averageByEvent.get(row.event) ?? null,
    }));
}

interface GameweekTransferSummary {
  event: number;
  transfersMade: number;
  freeCount: number;
  paidCount: number;
  costPoints: number;
  bankAfter: number;
}

const FREE_TRANSFER_CAP = 5;

// Reconstructs each gameweek's free-transfer bank using FPL's own rules
// (2024/25+: free transfers can be banked up to a cap of 5; playing a
// wildcard or free hit makes that gameweek's transfers unlimited and free
// without touching the bank at all). This is a simulation, not authoritative
// data — the public API has no endpoint exposing a manager's actual banked
// free-transfer count (that lives behind the authenticated "my-team"
// endpoint), so this reconstructs it from the season's own gameweek-by-
// gameweek transfer counts and known chip history.
function simulateFreeTransfers(
  gameweeks: GameweekHistoryRow[],
  chipsUsed: EntryHistoryChip[],
): GameweekTransferSummary[] {
  const sorted = [...gameweeks].sort((a, b) => a.event - b.event);
  const chipEvents = new Set(
    chipsUsed.filter((chip) => chip.name === "wildcard" || chip.name === "freehit").map((chip) => chip.event),
  );

  const summaries: GameweekTransferSummary[] = [];
  let bank = 1; // baseline entering gameweek 2 — gameweek 1 is initial squad selection, not a transfer gameweek

  for (const row of sorted) {
    if (row.event === 1) continue;

    if (chipEvents.has(row.event)) {
      bank = Math.min(bank + 1, FREE_TRANSFER_CAP);
      summaries.push({
        event: row.event,
        transfersMade: row.eventTransfers,
        freeCount: row.eventTransfers,
        paidCount: 0,
        costPoints: 0,
        bankAfter: bank,
      });
      continue;
    }

    const freeCount = Math.min(row.eventTransfers, bank);
    const paidCount = row.eventTransfers - freeCount;
    bank = Math.min(bank - freeCount + 1, FREE_TRANSFER_CAP);

    summaries.push({
      event: row.event,
      transfersMade: row.eventTransfers,
      freeCount,
      paidCount,
      costPoints: row.eventTransfersCost, // authoritative FPL total for the gameweek, not freeCount/paidCount-derived
      bankAfter: bank,
    });
  }

  return summaries;
}

// FPL tracks a transfer-cost total per gameweek, not per individual swap —
// when several transfers land in the same gameweek, this splits that
// gameweek's already-known free/paid split evenly across them in the order
// the API returns them, the closest available approximation to "which swap
// was free" since that distinction isn't actually tracked per-transfer.
function buildTransferHistory(
  transfers: TransferRecord[],
  elementsById: Map<number, FplElement>,
  summariesByEvent: Map<number, GameweekTransferSummary>,
): TransferHistoryEntry[] {
  const byEvent = new Map<number, TransferRecord[]>();
  for (const transfer of transfers) {
    const group = byEvent.get(transfer.event) ?? [];
    group.push(transfer);
    byEvent.set(transfer.event, group);
  }

  const entries: TransferHistoryEntry[] = [];
  for (const [event, group] of byEvent) {
    const freeCount = summariesByEvent.get(event)?.freeCount ?? group.length;

    group.forEach((transfer, index) => {
      entries.push({
        event,
        soldName: elementsById.get(transfer.elementOut)?.web_name ?? "Unknown player",
        boughtName: elementsById.get(transfer.elementIn)?.web_name ?? "Unknown player",
        costPoints: index < freeCount ? 0 : -4,
      });
    });
  }

  return entries.sort((a, b) => b.event - a.event);
}

// Everything the manager still needs to check or decide before the next
// deadline — captain/vice-captain are read straight off the live squad, the
// rest comes from the free-transfer simulation and this gameweek's chip use.
function buildUpcomingChanges(
  squad: SquadHealthPlayer[],
  gameweek: number,
  summariesByEvent: Map<number, GameweekTransferSummary>,
  chipsUsed: EntryHistoryChip[],
): UpcomingChanges {
  const currentSummary = summariesByEvent.get(gameweek);

  return {
    captainName: squad.find((player) => player.isCaptain)?.name ?? null,
    viceCaptainName: squad.find((player) => player.isViceCaptain)?.name ?? null,
    transfersThisGameweek: currentSummary?.transfersMade ?? 0,
    transfersCostThisGameweek: currentSummary?.costPoints ?? 0,
    freeTransfersNextWeek: currentSummary ? currentSummary.bankAfter : gameweek <= 1 ? 1 : null,
    chipsActivatedThisGameweek: chipsUsed
      .filter((chip) => chip.event === gameweek)
      .map((chip) => CHIP_LABELS[chip.name] ?? chip.name),
  };
}

const RED_STATUSES = new Set(["i", "s", "u", "n"]);

// Real-time health signal per squad player — trend from the shared 3-season
// digest (fast, no AI), plus live injury/lineup/rest data from API-Football.
// Independent of any manager's numeric FPL id, so this works identically for
// a real team and the fabricated demo squad.
async function buildSquadHealth(squad: SquadPlayer[]): Promise<SquadHealthPlayer[]> {
  const digest = await loadFootballDigest();
  const trendLookup = digest ? buildFplNameLookup(digest) : null;

  await preloadMatchContextCache().catch(() => undefined);

  const clubs = Array.from(new Set(squad.map((p) => p.club)));
  const restByClub = new Map<string, number | null>();
  await Promise.all(
    clubs.map(async (club) => {
      const rest = await getClubRestDays(club).catch(() => null);
      restByClub.set(club, rest?.restDays ?? null);
    }),
  );

  return Promise.all(
    squad.map(async (player) => {
      const digestPlayer = trendLookup?.get(player.name.toLowerCase().trim());
      const trend = digestPlayer ? classifyTrend(digestPlayer).direction : "unknown";

      const [injury, lineup] = await Promise.all([
        getInjuryForPlayer(player.club, player.name).catch(() => null),
        getLineupStatusForPlayer(player.club, player.name).catch(() => null),
      ]);

      const restDays = restByClub.get(player.club) ?? null;
      const lineupStatus = lineup?.status ?? "unknown";

      let health: SquadHealthPlayer["health"] = "green";
      if (RED_STATUSES.has(player.status) || injury) {
        health = "red";
      } else if (player.status === "d" || lineupStatus === "bench" || (restDays != null && restDays <= 3)) {
        health = "amber";
      }

      return {
        ...player,
        trend,
        restDays,
        injuryReason: injury?.reason ?? null,
        lineupStatus,
        health,
      };
    }),
  );
}

// Demo mode fabricates only the manager-specific bits an account needs
// (gameweek history, chip usage) that have no real numeric FPL entry behind
// them — squad health still runs on real, live data for the real players in
// the demo squad, same as the rest of the app's demo experience.
async function buildDemoDashboard(): Promise<DashboardData> {
  let bootstrap: BootstrapStatic | null = null;
  try {
    bootstrap = await fetchBootstrapStatic();
  } catch (error) {
    console.error("Failed to load bootstrap for demo dashboard", error);
  }

  const demo = getDemoTeamData(bootstrap);

  const chipsUsed: EntryHistoryChip[] = [{ name: "wildcard", event: 2 }];
  const chips = bootstrap ? computeChipStatus(bootstrap.chips, chipsUsed, demo.gameweek) : [];

  // Fabricated averages too, not joined from the real (currently-zero,
  // pre-season) bootstrap events — the real season hasn't reached these
  // gameweeks yet, so there's no real average to join against.
  const seasonHistory: SeasonHistoryRow[] = [
    { event: 1, points: 64, totalPoints: 64, overallRank: 612_000, pointsOnBench: 4, average: 58 },
    { event: 2, points: 51, totalPoints: 115, overallRank: 705_000, pointsOnBench: 9, average: 52 },
    { event: 3, points: 63, totalPoints: 178, overallRank: 452_301, pointsOnBench: 2, average: 55 },
  ];

  const squad = await buildSquadHealth(demo.squad);

  // No real numeric FPL entry behind the demo account, so no real
  // leagues.classic to filter — points at the same "demo" league id that
  // /league/demo and /api/league already serve.
  const leagues: DashboardLeague[] = [{ id: "demo", name: "Demo Mini-League" }];
  const whatsHappening = bootstrap ? buildWhatsHappening(bootstrap) : [];

  // No real numeric FPL entry behind the demo account, so no real transfer
  // history to fetch either — the panel still shows genuine captain/vice
  // picks off the (real) demo squad, just with an empty transfer list and a
  // simple baseline for the free-transfer/chip fields.
  const upcoming = buildUpcomingChanges(squad, demo.gameweek, new Map(), chipsUsed);

  return {
    teamId: DEMO_TEAM_ID,
    managerName: demo.managerName,
    teamName: demo.teamName,
    overallPoints: demo.overallPoints,
    overallRank: demo.overallRank,
    totalPlayers: demo.totalPlayers,
    gameweek: demo.gameweek,
    seasonStarted: true,
    isDemo: true,
    lastGameweekPoints: 63,
    lastGameweekAverage: 55,
    nextDeadline: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    bank: demo.bank,
    squadValue: demo.squadValue,
    chips,
    squad,
    seasonHistory,
    leagues,
    whatsHappening,
    transferHistory: [],
    upcoming,
  };
}

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId");

  if (teamId?.toLowerCase() === DEMO_TEAM_ID) {
    return NextResponse.json(await buildDemoDashboard());
  }

  if (!teamId || !/^\d+$/.test(teamId)) {
    return NextResponse.json({ error: "A valid numeric teamId is required." }, { status: 400 });
  }

  let entry;
  try {
    entry = await fetchEntry(teamId);
  } catch (error) {
    console.error("Failed to load FPL entry for dashboard", error);
    return NextResponse.json(
      { error: "Could not find that FPL team. Check the team ID and try again." },
      { status: 404 },
    );
  }

  const baseInfo = {
    teamId,
    managerName: `${entry.player_first_name} ${entry.player_last_name}`,
    teamName: entry.name,
    overallPoints: entry.summary_overall_points ?? 0,
    overallRank: entry.summary_overall_rank ?? 0,
    isDemo: false,
  };

  let bootstrap: BootstrapStatic;
  let history: Awaited<ReturnType<typeof fetchEntryHistory>>;
  try {
    [bootstrap, history] = await Promise.all([fetchBootstrapStatic(), fetchEntryHistory(teamId)]);
  } catch (error) {
    console.error("Failed to load bootstrap/history for dashboard", error);
    return NextResponse.json({ error: "Could not load season data right now." }, { status: 502 });
  }

  // Its own fetch/catch, separate from the bootstrap+history pair above —
  // this endpoint failing shouldn't take the whole dashboard down with it,
  // it just means the transfer-history panel degrades to empty.
  const transfers: TransferRecord[] = await fetchTransferHistory(teamId).catch((error) => {
    console.error("Failed to load transfer history for dashboard", error);
    return [];
  });

  const gameweek = getCurrentGameweek(bootstrap);
  const nextEvent = bootstrap.events.find((event) => event.is_next);
  const lastPlayedRow = [...history.gameweeks].sort((a, b) => b.event - a.event)[0] ?? null;
  const lastEventMeta = lastPlayedRow
    ? bootstrap.events.find((event) => event.id === lastPlayedRow.event)
    : undefined;

  const chips = computeChipStatus(bootstrap.chips, history.chipsUsed, gameweek);

  let squad: SquadPlayer[] = [];
  let seasonStarted = false;
  let bank = 0;
  let squadValue = 0;
  try {
    const picksResponse = await fetchPicks(teamId, gameweek);
    squad = buildSquad(picksResponse.picks, bootstrap);
    bank = picksResponse.entry_history.bank / 10;
    squadValue = picksResponse.entry_history.value / 10;
    seasonStarted = true;
  } catch (error) {
    // Before a season's fixtures begin, the picks endpoint 404s even for a
    // real team — the rest of the dashboard still renders from entry/history data.
    console.error("Gameweek picks not available yet for dashboard", error);
  }

  const squadHealth = seasonStarted ? await buildSquadHealth(squad) : [];

  const transferSummaries = simulateFreeTransfers(history.gameweeks, history.chipsUsed);
  const summariesByEvent = new Map(transferSummaries.map((summary) => [summary.event, summary]));
  const elementsById = new Map(bootstrap.elements.map((element) => [element.id, element]));

  const data: DashboardData = {
    ...baseInfo,
    totalPlayers: bootstrap.total_players,
    gameweek,
    seasonStarted,
    lastGameweekPoints: lastPlayedRow?.points ?? null,
    lastGameweekAverage: lastEventMeta?.average_entry_score ?? null,
    nextDeadline: nextEvent?.deadline_time ?? null,
    bank,
    squadValue,
    chips,
    squad: squadHealth,
    seasonHistory: buildSeasonHistory(history.gameweeks, bootstrap.events),
    leagues: getPrivateLeagues(entry),
    whatsHappening: buildWhatsHappening(bootstrap),
    transferHistory: buildTransferHistory(transfers, elementsById, summariesByEvent),
    upcoming: buildUpcomingChanges(squadHealth, gameweek, summariesByEvent, history.chipsUsed),
  };

  return NextResponse.json(data);
}
