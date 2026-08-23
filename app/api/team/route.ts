import { NextRequest, NextResponse } from "next/server";
import {
  buildSquad,
  fetchBootstrapStatic,
  fetchEntry,
  fetchPicks,
  getCurrentGameweek,
  getDemoTeamData,
  isDemoTeamId,
  type BootstrapStatic,
} from "@/lib/fpl";

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId");

  if (teamId && isDemoTeamId(teamId)) {
    let bootstrap: BootstrapStatic | null = null;
    try {
      bootstrap = await fetchBootstrapStatic();
    } catch (error) {
      console.error("Failed to load bootstrap for demo team", error);
    }
    return NextResponse.json(getDemoTeamData(bootstrap));
  }

  if (!teamId || !/^\d+$/.test(teamId)) {
    return NextResponse.json(
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
    return NextResponse.json(
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
    const picksResponse = await fetchPicks(teamId, gameweek);
    const squad = buildSquad(picksResponse.picks, bootstrap);

    return NextResponse.json({
      ...baseInfo,
      gameweek,
      bank: picksResponse.entry_history.bank / 10,
      squadValue: picksResponse.entry_history.value / 10,
      squad,
      seasonStarted: true,
    });
  } catch (error) {
    // Before a season's fixtures begin, the picks endpoint 404s even for a
    // real team — fall back to the entry-only info rather than erroring.
    console.error("Gameweek picks not available yet, falling back to entry-only data", error);
    return NextResponse.json({
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
