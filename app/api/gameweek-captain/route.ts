import { NextRequest, NextResponse } from "next/server";
import { fetchBootstrapStatic, fetchPicks } from "@/lib/fpl";

// Who did this manager actually captain in a specific (past) gameweek? Used
// by the dashboard's AI accuracy tracker to resolve a pending prediction
// once that gameweek has been played — kept as its own small route rather
// than overloading /api/team, since it answers a different question (a
// specific past gameweek's picks, not "my current squad").
export async function GET(request: NextRequest) {
  const teamId = request.nextUrl.searchParams.get("teamId");
  const gameweekParam = request.nextUrl.searchParams.get("gameweek");
  const gameweek = gameweekParam ? Number.parseInt(gameweekParam, 10) : NaN;

  if (!teamId || !/^\d+$/.test(teamId) || !Number.isInteger(gameweek) || gameweek < 1) {
    return NextResponse.json(
      { error: "A valid numeric teamId and gameweek are required." },
      { status: 400 },
    );
  }

  try {
    const [bootstrap, picksResponse] = await Promise.all([
      fetchBootstrapStatic(),
      fetchPicks(teamId, gameweek),
    ]);

    const captainPick = picksResponse.picks.find((pick) => pick.is_captain);
    const captainElement = captainPick
      ? bootstrap.elements.find((element) => element.id === captainPick.element)
      : undefined;

    return NextResponse.json({ captainName: captainElement?.web_name ?? null });
  } catch (error) {
    console.error("Failed to load gameweek captain", error);
    return NextResponse.json(
      { error: "Could not load that gameweek's picks." },
      { status: 502 },
    );
  }
}
