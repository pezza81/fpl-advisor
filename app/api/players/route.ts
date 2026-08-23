import { NextResponse } from "next/server";
import { buildAllPlayers, fetchBootstrapStatic } from "@/lib/fpl";
import { getPlayerXG } from "@/lib/understat";

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
    return NextResponse.json({ players });
  } catch (error) {
    console.error("Failed to load players", error);
    return NextResponse.json(
      { error: "Could not load player data. Try again shortly." },
      { status: 502 },
    );
  }
}
