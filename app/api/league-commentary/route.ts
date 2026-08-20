import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { SquadPlayer } from "@/lib/fpl";

interface CommentaryManagerInput {
  entryName: string;
  managerName: string;
  rank: number;
  total: number;
  eventTotal: number;
  squad: SquadPlayer[];
}

interface CommentaryRequestBody {
  leagueName?: string;
  gameweek?: number;
  managers?: CommentaryManagerInput[];
}

function formatManagerForPrompt(manager: CommentaryManagerInput): string {
  const captain = manager.squad.find((p) => p.isCaptain);
  const sellFlags = manager.squad.filter((p) => p.flag === "SELL").map((p) => p.name);
  const squadList = manager.squad.map((p) => `${p.name} (${p.club})`).join(", ");

  return [
    `${manager.rank}. ${manager.entryName} (${manager.managerName}) — ${manager.total} pts total, ${manager.eventTotal} this gameweek.`,
    `Captain: ${captain?.name ?? "not set"}.`,
    sellFlags.length > 0 ? `Flagged for sale: ${sellFlags.join(", ")}.` : "No players flagged.",
    `Full squad: ${squadList}`,
  ].join(" ");
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: CommentaryRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { leagueName, gameweek, managers } = body;
  if (!managers || !Array.isArray(managers) || managers.length === 0) {
    return NextResponse.json({ error: "A non-empty managers array is required." }, { status: 400 });
  }

  const managerLines = managers
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(formatManagerForPrompt)
    .join("\n\n");

  const prompt = `You are a witty Fantasy Premier League pundit doing the weekly banter round-up for a friends' mini-league called "${leagueName ?? "this league"}" ahead of gameweek ${gameweek ?? "the next gameweek"}.

Current standings, captains, sale flags and full squads:

${managerLines}

Write 3-4 short, fun paragraphs of commentary — plain English, no markdown, no bullet points, no headers. Call out specific managers and players by name: who's in great form and should be feeling smug, who's got a shaky squad full of flagged players and is about to drop down the table, any standout captain picks, and any obviously weak links worth some friendly banter. Be playful and a little cheeky like you're winding up your mates in a group chat, but keep it good-natured, not mean-spirited. Reference actual names and numbers from the data above rather than generic filler.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const commentary = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    return NextResponse.json({ commentary });
  } catch (error) {
    console.error("Failed to generate league commentary", error);
    return NextResponse.json(
      { error: "Could not generate league commentary right now. Try again shortly." },
      { status: 502 },
    );
  }
}
