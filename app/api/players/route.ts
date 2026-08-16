import { NextResponse } from "next/server";
import { buildAllPlayers, fetchBootstrapStatic } from "@/lib/fpl";

export async function GET() {
  try {
    const bootstrap = await fetchBootstrapStatic();
    const players = buildAllPlayers(bootstrap);
    return NextResponse.json({ players });
  } catch (error) {
    console.error("Failed to load players", error);
    return NextResponse.json(
      { error: "Could not load player data. Try again shortly." },
      { status: 502 },
    );
  }
}
