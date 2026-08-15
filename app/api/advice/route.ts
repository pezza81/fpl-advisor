import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { SquadPlayer } from "@/lib/fpl";
import {
  buildFplNameLookup,
  classifyTrend,
  findRisingCandidates,
  formatTrendLine,
  loadFootballDigest,
} from "@/lib/football-trends";
import { splitLabeledSections } from "@/lib/text";

interface AdviceRequestBody {
  teamName?: string;
  gameweek?: number;
  bank?: number;
  squadValue?: number;
  squad?: SquadPlayer[];
}

const SECTION_LABELS = ["TRANSFER", "CAPTAIN", "CHIP", "ACTIONS"] as const;

// Strips any bullet/numbering Claude adds despite instructions ("- Sell X",
// "1. Sell X", "• Sell X") and drops blank lines.
function parseActionItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[\s•\-*]+|^\d+[.)]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

// Cross-references the user's squad against the 3-season trend digest and
// returns prompt-ready text: which of their own players are trending up or
// down, plus a pool of affordable, trending-up players outside the squad
// worth suggesting as transfer targets. Returns "" if no digest has been
// pulled yet (npm run fetch:football) — trend-awareness degrades gracefully
// rather than breaking advice generation.
async function buildTrendContext(squad: SquadPlayer[]): Promise<string> {
  const digest = await loadFootballDigest();
  if (!digest) return "";

  const lookup = buildFplNameLookup(digest);
  const squadWebNames = new Set(squad.map((p) => p.name.toLowerCase().trim()));

  const squadTrendLines = squad
    .map((squadPlayer) => {
      const digestPlayer = lookup.get(squadPlayer.name.toLowerCase().trim());
      if (!digestPlayer) return null;
      const trend = classifyTrend(digestPlayer);
      if (trend.direction === "stable") return null;
      return formatTrendLine(digestPlayer, trend, squadPlayer.price);
    })
    .filter((line): line is string => line !== null);

  const risingCandidates = findRisingCandidates(digest, squadWebNames, 25);
  const risingLines = risingCandidates.map((player) =>
    formatTrendLine(player, player.trend, player.currentPrice),
  );

  if (squadTrendLines.length === 0 && risingLines.length === 0) return "";

  const squadSection =
    squadTrendLines.length > 0
      ? `Players already in this squad with a notable 3-season trend:\n${squadTrendLines.join("\n")}`
      : "No player currently in this squad has a strong enough season-over-season trend to flag either way.";

  const risingSection =
    risingLines.length > 0
      ? `Players NOT in this squad whose output is trending upward league-wide (potential transfer targets, cheapest and biggest risers first is not guaranteed — check price against bank yourself):\n${risingLines.join("\n")}`
      : "";

  return `\nHistorical trend data (3 real Premier League seasons via API-Football, cross-referenced against this squad):\n\n${squadSection}\n\n${risingSection}\n`;
}

function formatSquadForPrompt(squad: SquadPlayer[]): string {
  return squad
    .map((player) => {
      const role = player.isCaptain
        ? " (captain)"
        : player.isViceCaptain
          ? " (vice-captain)"
          : "";
      const bench = player.isStarting ? "" : " (bench)";
      const flag = player.news ? ` — ${player.news}` : "";
      return `${player.position} ${player.name} (${player.club}), £${player.price}m, form ${player.form}, ${player.totalPoints} pts${role}${bench}${flag}`;
    })
    .join("\n");
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: AdviceRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { squad, teamName, gameweek, bank, squadValue } = body;
  if (!squad || !Array.isArray(squad) || squad.length === 0) {
    return NextResponse.json(
      { error: "A non-empty squad array is required." },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  const trendContext = await buildTrendContext(squad);

  const prompt = `You are a sharp, friendly Fantasy Premier League expert giving advice to a mate ahead of gameweek ${gameweek ?? "the next gameweek"}.

Team: ${teamName ?? "Unknown"}
Bank: £${bank ?? 0}m
Squad value: £${squadValue ?? 0}m

Current 15-man squad (position, name, club, price, form, total points, role):
${formatSquadForPrompt(squad)}
${trendContext}
Give advice in plain English, written like a knowledgeable friend chatting over a pint — no markdown, no bullet points, no headers other than the four labels below, no asterisks. Keep the TRANSFER, CAPTAIN and CHIP sections to two or three sentences each.

${trendContext ? "Be trend-aware, not just form-aware: this week's form is a snapshot, the 3-season trend data above is the pattern behind it. If a squad player is flagged as declining, say so explicitly and treat that as a real reason to consider moving them on even if their current form looks okay. If a squad player is flagged as rising, that strengthens the case to keep or captain them. When recommending a transfer target, prefer someone from the trending-upward list if they fit the budget (bank plus a realistic sale price) and the position needed — name the specific trend evidence (e.g. \"his G+A jumped from X to Y last season\") rather than just their current form. Only fall back to reasoning from current price and form when the trend data doesn't cover a relevant player.\n\n" : ""}Respond with exactly four sections, each starting on its own line with the label followed by a colon, in this order:

TRANSFER: your recommendation on who to transfer out and in, or hold, and why.
CAPTAIN: your captain and vice-captain pick for this gameweek and why.
CHIP: whether to consider playing a chip (wildcard, bench boost, triple captain, free hit) this week or hold off, and why.
ACTIONS: no fewer than 3 and no more than 5 lines total — pick the most important actions only, one per line, no bullets, no numbering, no dashes, just the plain instruction. Use simple direct language a checklist would use, e.g. "Sell Kulusevski", "Buy a nailed-on £6.5m midfielder", "Captain Haaland this week", "Hold your chips". Each line must be a single concrete action, not a sentence of reasoning. Do not exceed 5 lines under any circumstances.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      // Opus 5 thinks by default and max_tokens caps thinking + the visible
      // answer together. Cross-referencing squad + trend data is a harder
      // reasoning task than plain squad advice, so keep generous headroom.
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const sections = splitLabeledSections(rawText, SECTION_LABELS);

    return NextResponse.json({
      transfer: sections.TRANSFER,
      captain: sections.CAPTAIN,
      chip: sections.CHIP,
      actions: parseActionItems(sections.ACTIONS),
    });
  } catch (error) {
    console.error("Failed to generate FPL advice", error);
    return NextResponse.json(
      { error: "Could not generate advice right now. Try again shortly." },
      { status: 502 },
    );
  }
}
