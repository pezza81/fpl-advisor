import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildFplNameLookup,
  classifyMinutesTrend,
  classifyTrend,
  loadFootballDigest,
  type MinutesTrend,
  type PlayerTrend,
} from "@/lib/football-trends";
import { fetchFplSeasonHistory, type FplSeasonRow } from "@/lib/fpl-history";

interface PlayerInsightRequestBody {
  id?: number;
  name?: string;
  position?: string;
  club?: string;
  price?: number;
  form?: number;
  totalPoints?: number;
  news?: string;
}

function describeTrend(trend: PlayerTrend): string {
  if (trend.direction === "unknown") {
    return "No 3-season historical trend data is available for this player (no match in the API-Football dataset).";
  }
  if (trend.previousSeason == null || trend.latestSeason == null) {
    return "This player only has one season of historical data, not enough to call a trend.";
  }
  return `3-season trend: ${trend.previousSeason}: ${trend.previousOutput} combined goals+assists -> ${trend.latestSeason}: ${trend.latestOutput} combined goals+assists (${trend.direction}).`;
}

function describeMinutesTrend(trend: MinutesTrend): string {
  if (trend.direction === "unknown" || trend.previousSeason == null || trend.latestSeason == null) {
    return "";
  }
  return ` Minutes played: ${trend.previousSeason}: ${trend.previousMinutes} -> ${trend.latestSeason}: ${trend.latestMinutes} (${trend.direction}).`;
}

// Position-specific season lines for the prompt, e.g. for a defender:
// "2023/24: 10 clean sheets, 2 goals, 3 assists, 8 bonus (3100 mins)"
// Matches exactly the stat set the UI shows for that position.
function describeSeasonHistory(position: string | undefined, seasons: FplSeasonRow[]): string {
  if (seasons.length === 0) {
    return "No official FPL season-history data is available for this player (either new to the Premier League or not tracked by FPL yet).";
  }

  const normalizedPosition = (position ?? "").toUpperCase();
  const lines = seasons.map((s) => {
    if (normalizedPosition === "GKP") {
      return `${s.seasonLabel}: ${s.cleanSheets} clean sheets, ${s.saves} saves, ${s.goalsConceded} conceded, ${s.bonus} bonus (${s.minutes} mins)`;
    }
    if (normalizedPosition === "DEF") {
      return `${s.seasonLabel}: ${s.cleanSheets} clean sheets, ${s.goals} goals, ${s.assists} assists, ${s.bonus} bonus (${s.minutes} mins)`;
    }
    if (normalizedPosition === "FWD") {
      return `${s.seasonLabel}: ${s.goals} goals, ${s.assists} assists, ${s.bonus} bonus (${s.minutes} mins)`;
    }
    // MID and any unrecognized position fall back to the goals/assists/involvements view.
    return `${s.seasonLabel}: ${s.goals} goals, ${s.assists} assists, ${s.involvements} involvements, ${s.bonus} bonus (${s.minutes} mins)`;
  });

  return `Official FPL season history (real bonus points and, where relevant, clean sheets — source: FPL's own historical archive, not API-Football):\n${lines.join("\n")}`;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let body: PlayerInsightRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { id, name, position, club, price, form, totalPoints, news } = body;
  if (!name) {
    return NextResponse.json({ error: "A player name is required." }, { status: 400 });
  }

  const [digest, fplSeasons] = await Promise.all([
    loadFootballDigest(),
    fetchFplSeasonHistory(id ?? 0),
  ]);

  let trend: PlayerTrend = {
    direction: "unknown",
    latestSeason: null,
    previousSeason: null,
    latestOutput: null,
    previousOutput: null,
  };
  let minutesTrend: MinutesTrend = {
    direction: "unknown",
    latestSeason: null,
    previousSeason: null,
    latestMinutes: null,
    previousMinutes: null,
  };

  if (digest) {
    const digestPlayer = buildFplNameLookup(digest).get(name.toLowerCase().trim());
    if (digestPlayer) {
      trend = { ...classifyTrend(digestPlayer) };
      minutesTrend = { ...classifyMinutesTrend(digestPlayer) };
    }
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a concise Fantasy Premier League analyst. A user is looking at one player in their squad and wants a quick verdict on whether to keep them this season.

Player: ${name} (${position ?? "unknown position"}, ${club ?? "unknown club"})
Price: £${price ?? "?"}m
Current form: ${form ?? "?"}
Total points this season: ${totalPoints ?? "?"}
${news ? `Availability news: ${news}` : "No injury or availability concerns reported."}
${describeTrend(trend)}${describeMinutesTrend(minutesTrend)}

${describeSeasonHistory(position, fplSeasons)}

Write a verdict on whether this player is worth keeping this season, structured as exactly 2 to 3 short paragraphs separated by a blank line (a real blank line between paragraphs, not just a sentence break) — for example, one paragraph weighing current form against the historical trend, and a second paragraph on the position-specific benchmark judgment and final call. Do not write one continuous block.

In the first paragraph, weigh their current form against the goal-involvement trend above — if the trend and current form agree, say so plainly; if they conflict, call that out and explain which signal you'd trust more. If minutes are declining even while returns hold up, treat that as a real rotation-risk warning. In the next paragraph, using the official season history, judge the player against a position-specific benchmark: for a goalkeeper or defender, is their clean-sheet rate strong for a side of their club's level; for any position, is their bonus-points rate high (a proxy for good underlying performances, not just end product) or low for a player at this price; for attacking players, are goals+assists strong relative to price. Close with a direct call — keep, consider selling, or keep an eye on them. Name the actual numbers you're weighing throughout. Plain English, no markdown, no bullet points, no asterisks, write like a knowledgeable friend giving a direct opinion.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      // A few sentences of output, but Opus 5 thinks by default and
      // max_tokens caps thinking + the visible answer together — this prompt
      // is now denser (trend + full season history + position benchmarking).
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const summary = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    return NextResponse.json({ trend, minutesTrend, fplSeasons, summary });
  } catch (error) {
    console.error("Failed to generate player insight", error);
    return NextResponse.json(
      { error: "Could not generate a player insight right now. Try again shortly." },
      { status: 502 },
    );
  }
}
