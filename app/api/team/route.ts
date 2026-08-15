import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_TEAM_ID,
  buildSquad,
  fetchBootstrapStatic,
  fetchEntry,
  fetchPicks,
  getCurrentGameweek,
  getDemoTeamData,
} from "@/lib/fpl";

export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId");

  if (teamId?.toLowerCase() === DEMO_TEAM_ID) {
    return NextResponse.json(getDemoTeamData());
  }

  if (!teamId || !/^\d+$/.test(teamId)) {
    return NextResponse.json(
      { error: "A valid numeric teamId is required." },
      { status: 400 },
    );
  }

  try {
    const bootstrap = await fetchBootstrapStatic();
    const gameweek = getCurrentGameweek(bootstrap);

    const [entry, picksResponse] = await Promise.all([
      fetchEntry(teamId),
      fetchPicks(teamId, gameweek),
    ]);

    const squad = buildSquad(picksResponse.picks, bootstrap);

    return NextResponse.json({
      teamId,
      gameweek,
      managerName: `${entry.player_first_name} ${entry.player_last_name}`,
      teamName: entry.name,
      overallPoints: entry.summary_overall_points,
      overallRank: entry.summary_overall_rank,
      bank: picksResponse.entry_history.bank / 10,
      squadValue: picksResponse.entry_history.value / 10,
      squad,
    });
  } catch (error) {
    console.error("Failed to load FPL team", error);
    return NextResponse.json(
      { error: "Could not find that FPL team. Check the team ID and try again." },
      { status: 404 },
    );
  }
}
