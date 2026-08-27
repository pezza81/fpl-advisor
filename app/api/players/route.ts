import { NextResponse } from "next/server";
import { buildAllPlayers, fetchBootstrapStatic } from "@/lib/fpl";
import { getPlayerXG, getTopXGPer90Players } from "@/lib/understat";

const LEADER_POSITIONS = ["GKP", "DEF", "MID", "FWD"] as const;

export async function GET() {
  try {
    const bootstrap = await fetchBootstrapStatic();
    const players = await Promise.all(
      buildAllPlayers(bootstrap).map(async (player) => {
        const stats = await getPlayerXG(player.name);
        return {
          ...player,
          xG: stats?.xG ?? null,
          xA: stats?.xA ?? null,
        };
      }),
    );

    const xgLeaderEntries = await Promise.all(
      LEADER_POSITIONS.map(async (position) => [position, await getTopXGPer90Players(position, 20)] as const),
    );
    const xgLeaders = Object.fromEntries(xgLeaderEntries);

    return NextResponse.json({ players, xgLeaders });
  } catch (error) {
    console.error("Failed to load players", error);
    return NextResponse.json(
      { error: "Could not load player data. Try again shortly." },
      { status: 502 },
    );
  }
}
