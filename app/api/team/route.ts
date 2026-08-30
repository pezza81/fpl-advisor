import { NextRequest, NextResponse } from "next/server";
import {
  buildSquad,
  fetchBootstrapStatic,
  fetchEntry,
  fetchMyTeam,
  fetchPicks,
  getCurrentGameweek,
  getDemoTeamData,
  isDemoTeamId,
  type BootstrapStatic,
  type SquadPlayer,
} from "@/lib/fpl";

// Never statically rendered/cached by Next's build-time optimization — this
// route's whole point is live squad data (captain, transfers, bank), so a
// cached response is a stale one.
export const dynamic = "force-dynamic";

// NextResponse.json alone doesn't stop Vercel's edge/CDN from caching this
// route's response — an explicit no-store header on every response path
// (including errors) is what actually guarantees a live team's picks are
// re-fetched on every request rather than served from cache.
function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store, max-age=0", ...init?.headers },
  });
}

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId");
  // Header, not a query param, so a session token never ends up in a URL
  // (browser history, server access logs, Referer headers).
  const sessionCookie = request.headers.get("x-fpl-session");

  if (teamId && isDemoTeamId(teamId)) {
    let bootstrap: BootstrapStatic | null = null;
    try {
      bootstrap = await fetchBootstrapStatic();
    } catch (error) {
      console.error("Failed to load bootstrap for demo team", error);
    }
    return jsonNoStore(getDemoTeamData(bootstrap));
  }

  if (!teamId || !/^\d+$/.test(teamId)) {
    return jsonNoStore(
      { error: "A valid numeric teamId is required." },
      { status: 400 },
    );
  }

  // The entry endpoint (manager/team name, overall points) is available
  // year-round, unlike gameweek picks — fetched first and on its own so a
  // real "no such team" 404 isn't conflated with "picks aren't out yet".
  let entry;
  try {
    entry = await fetchEntry(teamId);
  } catch (error) {
    console.error("Failed to load FPL entry", error);
    return jsonNoStore(
      { error: "Could not find that FPL team. Check the team ID and try again." },
      { status: 404 },
    );
  }

  try {
    const bootstrap = await fetchBootstrapStatic();
    const baseInfo = {
      teamId,
      managerName: `${entry.player_first_name} ${entry.player_last_name}`,
      teamName: entry.name,
      overallPoints: entry.summary_overall_points ?? 0,
      overallRank: entry.summary_overall_rank ?? 0,
      totalPlayers: bootstrap.total_players,
    };

    const gameweek = getCurrentGameweek(bootstrap);

    let squad: SquadPlayer[] | null = null;
    let bank = 0;
    let squadValue = 0;
    let isLive = false;
    let sessionExpired = false;

    // Tried first, and only when a session token was actually supplied —
    // this is the authenticated, pre-deadline view (captain swaps, bench
    // order, lineup changes not yet locked in). Any failure here (expired
    // session, FPL error) just falls through to the public picks endpoint
    // below rather than failing the whole request.
    if (sessionCookie) {
      try {
        const myTeam = await fetchMyTeam(teamId, sessionCookie);
        squad = buildSquad(myTeam.picks, bootstrap);
        bank = myTeam.transfers.bank / 10;
        squadValue = myTeam.transfers.value / 10;
        isLive = true;
      } catch (liveError) {
        console.error("Live my-team fetch failed, falling back to public picks", liveError);
        sessionExpired = true;
      }
    }

    if (!squad) {
      const picksResponse = await fetchPicks(teamId, gameweek);
      squad = buildSquad(picksResponse.picks, bootstrap);
      bank = picksResponse.entry_history.bank / 10;
      squadValue = picksResponse.entry_history.value / 10;
    }

    return jsonNoStore({
      ...baseInfo,
      gameweek,
      bank,
      squadValue,
      squad,
      seasonStarted: true,
      isLive,
      sessionExpired,
    });
  } catch (error) {
    // Before a season's fixtures begin, the picks endpoint 404s even for a
    // real team — fall back to the entry-only info rather than erroring.
    console.error("Gameweek picks not available yet, falling back to entry-only data", error);
    return jsonNoStore({
      teamId,
      managerName: `${entry.player_first_name} ${entry.player_last_name}`,
      teamName: entry.name,
      overallPoints: entry.summary_overall_points ?? 0,
      overallRank: entry.summary_overall_rank ?? 0,
      totalPlayers: 0,
      gameweek: 0,
      bank: 0,
      squadValue: 0,
      squad: [],
      seasonStarted: false,
    });
  }
}
