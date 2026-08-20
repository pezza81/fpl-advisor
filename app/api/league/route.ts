import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSquad,
  fetchBootstrapStatic,
  fetchLeagueStandings,
  fetchPicks,
  getCurrentGameweek,
  getDemoTeamData,
  type BootstrapStatic,
  type SquadPlayer,
} from "@/lib/fpl";
import {
  buildFplNameLookup,
  classifyTrend,
  loadFootballDigest,
  type DigestPlayer,
} from "@/lib/football-trends";
import { fplClubToTeamName, getLeagueStrengthRankings } from "@/lib/team-stats";
import { extractJsonArray } from "@/lib/text";
import type { LeagueData, LeagueManagerRow } from "@/lib/league-types";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function movementFor(rank: number, lastRank: number): LeagueManagerRow["movement"] {
  if (lastRank === 0) return "new";
  if (rank < lastRank) return "up";
  if (rank > lastRank) return "down";
  return "same";
}

interface WeekAheadInput {
  entry: number | string;
  entryName: string;
  managerName: string;
  squad: SquadPlayer[];
}

interface WeekAheadResult {
  score: number;
  reason: string;
}

// One line of evidence per manager (squad form/availability, 3-season trend
// counts from the shared digest, and their captain's club real xG attacking/
// defensive strength) — everything Claude needs to score the week ahead,
// with no live API-football calls (this stays fast even for a full league page).
function buildWeekAheadPrompt(managers: WeekAheadInput[], trendLookup: Map<string, DigestPlayer> | null): string {
  let rankings: ReturnType<typeof getLeagueStrengthRankings> = [];
  try {
    rankings = getLeagueStrengthRankings();
  } catch (error) {
    console.error("Failed to load team strength rankings for week-ahead scoring", error);
  }
  const rankByTeam = new Map(rankings.map((r) => [r.teamName, r]));

  const lines = managers.map((manager) => {
    const captain = manager.squad.find((p) => p.isCaptain);
    const sellFlagCount = manager.squad.filter((p) => p.flag === "SELL").length;
    const avgForm =
      manager.squad.length > 0
        ? round1(manager.squad.reduce((sum, p) => sum + p.form, 0) / manager.squad.length)
        : 0;

    let rising = 0;
    let declining = 0;
    for (const player of manager.squad) {
      const digestPlayer = trendLookup?.get(player.name.toLowerCase().trim());
      if (!digestPlayer) continue;
      const direction = classifyTrend(digestPlayer).direction;
      if (direction === "rising") rising += 1;
      if (direction === "declining") declining += 1;
    }

    let captainLine = "no captain set";
    if (captain) {
      const teamName = fplClubToTeamName(captain.club);
      const rank = teamName ? rankByTeam.get(teamName) : undefined;
      captainLine = rank
        ? `captain ${captain.name} (${captain.club}) — club ranked ${rank.attackRank}/${rankings.length} attack, ${rank.defenseRank}/${rankings.length} defense (${rank.avgXgFor} xG for, ${rank.avgXgAgainst} xG against per game)`
        : `captain ${captain.name} (${captain.club}, no xG data on record)`;
    }

    return `Entry ${manager.entry} - ${manager.entryName} (${manager.managerName}): avg squad form ${avgForm}, ${sellFlagCount} players flagged for sale (poor availability/form), ${rising} rising-trend / ${declining} declining-trend players (3-season digest), ${captainLine}.`;
  });

  return `You are a sharp FPL analyst. For each manager below, predict how good or bad their gameweek is likely to be, based only on the evidence given (squad form, injury/availability flags, 3-season trend direction, and their captain's club real xG attacking/defensive strength).

${lines.join("\n")}

Respond with ONLY a JSON array, no markdown, no commentary outside the JSON, exactly one object per manager in the same order:
[{"entry": <entry id from the list above, exactly as given, same type>, "score": <integer 1-10, 10 = great week ahead, 1 = rough week ahead>, "reason": "<one short sentence citing specific evidence from above>"}]`;
}

async function computeWeekAheadScores(
  managers: WeekAheadInput[],
  apiKey: string,
): Promise<Map<string, WeekAheadResult>> {
  const results = new Map<string, WeekAheadResult>();
  if (managers.length === 0) return results;

  const digest = await loadFootballDigest();
  const trendLookup = digest ? buildFplNameLookup(digest) : null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: Math.max(2048, managers.length * 100),
      messages: [{ role: "user", content: buildWeekAheadPrompt(managers, trendLookup) }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = extractJsonArray(rawText);

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (
          item &&
          typeof item === "object" &&
          "entry" in item &&
          "score" in item &&
          "reason" in item
        ) {
          const key = String((item as { entry: unknown }).entry);
          const score = Number((item as { score: unknown }).score);
          const reason = String((item as { reason: unknown }).reason);
          if (Number.isFinite(score)) {
            results.set(key, { score: Math.round(score), reason });
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to generate week-ahead scores", error);
  }

  return results;
}

async function buildManagerSquads(
  entries: { entry: number; entryName: string; managerName: string }[],
  bootstrap: BootstrapStatic,
  gameweek: number,
): Promise<Map<number, SquadPlayer[]>> {
  const byEntry = new Map<number, SquadPlayer[]>();

  await Promise.all(
    entries.map(async ({ entry }) => {
      try {
        const picksResponse = await fetchPicks(entry, gameweek);
        byEntry.set(entry, buildSquad(picksResponse.picks, bootstrap));
      } catch (error) {
        console.error(`Failed to load squad for league entry ${entry}`, error);
        byEntry.set(entry, []);
      }
    }),
  );

  return byEntry;
}

const DEMO_MANAGERS = [
  { suffix: "1", entryName: "Demo FC", managerName: "Demo Manager", rank: 1, lastRank: 2, total: 178, eventTotal: 63 },
  { suffix: "2", entryName: "Kane and Able", managerName: "Priya Shah", rank: 2, lastRank: 1, total: 172, eventTotal: 58 },
  { suffix: "3", entryName: "Salah-ry Man", managerName: "Tom Reid", rank: 3, lastRank: 4, total: 165, eventTotal: 61 },
  { suffix: "4", entryName: "Boujee Boys", managerName: "Amara Okafor", rank: 4, lastRank: 3, total: 160, eventTotal: 49 },
  { suffix: "5", entryName: "xG Marks the Spot", managerName: "Liam Foster", rank: 5, lastRank: 5, total: 151, eventTotal: 55 },
  { suffix: "6", entryName: "Gegenpressing FC", managerName: "Sofia Mancini", rank: 6, lastRank: 0, total: 144, eventTotal: 52 },
];

async function buildDemoLeague(apiKey: string | undefined): Promise<LeagueData> {
  const demoSquad = getDemoTeamData().squad;

  const managerInputs: WeekAheadInput[] = DEMO_MANAGERS.map((manager) => ({
    entry: `demo${manager.suffix}`,
    entryName: manager.entryName,
    managerName: manager.managerName,
    squad: demoSquad,
  }));

  const weekAhead = apiKey ? await computeWeekAheadScores(managerInputs, apiKey) : new Map();

  const managers: LeagueManagerRow[] = DEMO_MANAGERS.map((manager) => {
    const entry = `demo${manager.suffix}`;
    const score = weekAhead.get(entry);
    return {
      entry,
      entryName: manager.entryName,
      managerName: manager.managerName,
      rank: manager.rank,
      lastRank: manager.lastRank,
      total: manager.total,
      eventTotal: manager.eventTotal,
      movement: movementFor(manager.rank, manager.lastRank),
      weekAheadScore: score?.score ?? null,
      weekAheadReason: score?.reason ?? null,
      squad: demoSquad,
    };
  });

  return {
    leagueId: "demo",
    leagueName: "Demo Mini-League",
    gameweek: 3,
    isDemo: true,
    hasStandings: true,
    managers,
  };
}

export async function GET(request: NextRequest) {
  const leagueId = request.nextUrl.searchParams.get("leagueId");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const hasApiKey = Boolean(apiKey && apiKey !== "placeholder");

  if (leagueId?.toLowerCase() === "demo") {
    return NextResponse.json(await buildDemoLeague(hasApiKey ? apiKey : undefined));
  }

  if (!leagueId || !/^\d+$/.test(leagueId)) {
    return NextResponse.json({ error: "A valid numeric league ID is required." }, { status: 400 });
  }

  let standings;
  try {
    standings = await fetchLeagueStandings(leagueId);
  } catch (error) {
    console.error("Failed to load league standings", error);
    return NextResponse.json(
      { error: "Could not find that league. Check the league ID and try again." },
      { status: 404 },
    );
  }

  if (standings.rows.length === 0) {
    return NextResponse.json({
      leagueId,
      leagueName: standings.leagueName,
      gameweek: 0,
      isDemo: false,
      hasStandings: false,
      managers: [],
    } satisfies LeagueData);
  }

  let bootstrap: BootstrapStatic;
  try {
    bootstrap = await fetchBootstrapStatic();
  } catch (error) {
    console.error("Failed to load bootstrap for league", error);
    return NextResponse.json({ error: "Could not load player data right now." }, { status: 502 });
  }

  const gameweek = getCurrentGameweek(bootstrap);
  const squadsByEntry = await buildManagerSquads(standings.rows, bootstrap, gameweek);

  const managerInputs: WeekAheadInput[] = standings.rows.map((row) => ({
    entry: row.entry,
    entryName: row.entryName,
    managerName: row.managerName,
    squad: squadsByEntry.get(row.entry) ?? [],
  }));
  const weekAhead = hasApiKey && apiKey ? await computeWeekAheadScores(managerInputs, apiKey) : new Map();

  const managers: LeagueManagerRow[] = standings.rows.map((row) => {
    const score = weekAhead.get(String(row.entry));
    return {
      entry: row.entry,
      entryName: row.entryName,
      managerName: row.managerName,
      rank: row.rank,
      lastRank: row.lastRank,
      total: row.total,
      eventTotal: row.eventTotal,
      movement: movementFor(row.rank, row.lastRank),
      weekAheadScore: score?.score ?? null,
      weekAheadReason: score?.reason ?? null,
      squad: squadsByEntry.get(row.entry) ?? [],
    };
  });

  const data: LeagueData = {
    leagueId,
    leagueName: standings.leagueName,
    gameweek,
    isDemo: false,
    hasStandings: true,
    managers,
  };

  return NextResponse.json(data);
}
