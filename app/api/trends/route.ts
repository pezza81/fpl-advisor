import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { formatDigestForPrompt, loadFootballDigest } from "@/lib/football-trends";

const trendSectionSchema = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "The single most important, skimmable insight from this section — one punchy sentence, name a specific player or number.",
    },
    highlights: {
      type: "array",
      description: "3 to 5 key player callouts that back up the headline.",
      items: {
        type: "object",
        properties: {
          player: { type: "string", description: "Player name, exactly as in the data." },
          note: {
            type: "string",
            description: "A short phrase (under 12 words) with the concrete stat behind the callout.",
          },
        },
        required: ["player", "note"],
        additionalProperties: false,
      },
    },
    detail: {
      type: "string",
      description:
        "2 to 4 sentences of supporting reasoning for readers who want more than the headline and highlights.",
    },
  },
  required: ["headline", "highlights", "detail"],
  additionalProperties: false,
} as const;

const trendsSchema = {
  type: "object",
  properties: {
    captaincy: trendSectionSchema,
    seasonalForm: trendSectionSchema,
    pricePerformance: trendSectionSchema,
    earlyLate: trendSectionSchema,
  },
  required: ["captaincy", "seasonalForm", "pricePerformance", "earlyLate"],
  additionalProperties: false,
};

export async function GET() {
  const digest = await loadFootballDigest();

  if (!digest) {
    return NextResponse.json(
      {
        error:
          "No historical data found. Run `npm run fetch:football` to pull it from API-Football first.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    generatedAt: digest.generatedAt,
    seasons: digest.seasons,
    earlyRounds: digest.earlyRounds,
    lateRounds: digest.lateRounds,
    totalPlayersConsidered: digest.totalPlayersConsidered,
    playersInDigest: digest.playersInDigest,
  });
}

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  const digest = await loadFootballDigest();
  if (!digest) {
    return NextResponse.json(
      {
        error:
          "No historical data found. Run `npm run fetch:football` to pull it from API-Football first.",
      },
      { status: 404 },
    );
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a data-driven Fantasy Premier League analyst. Below is real Premier League player data covering ${digest.seasons.join(", ")} — three seasons pulled from API-Football, covering all ${digest.playersInDigest} players with at least 500 minutes of game time across that window (out of ${digest.totalPlayersConsidered} who featured at all). This is deliberately broad, not just the season's biggest stars — rotation players, squad regulars, and hidden value picks are all in scope, so surface them where the data supports it, not just the household names.

Each row covers one player across the three seasons. "early" figures are goal/assist involvements from rounds ${digest.earlyRounds[0]}-${digest.earlyRounds.at(-1)} of that season; "late" figures are from rounds ${digest.lateRounds[0]}-${digest.lateRounds.at(-1)}. Price is each player's current FPL price where a match was found (some are "unknown" — a name-matching gap between datasets, not missing data).

${formatDigestForPrompt(digest)}

Analyze this data for four angles: captaincy trends, seasonal form patterns, price vs performance, and early-vs-late-season behaviour. For each angle, write for someone skimming, not reading — lead with the single sharpest insight, back it with a handful of named player callouts, and only then the supporting reasoning. Every claim must trace back to a specific player and number in the table above. Do not invent players or stats that aren't in the data. No markdown, no bullet characters, no asterisks anywhere in the text fields — plain sentences only.

captaincy: which players have historically been the safest or highest-ceiling captaincy picks, and why — consistency across seasons, goal involvement rate, etc.
seasonalForm: patterns in how player output shifts across a season or across the three years — who trends up, who declines, who's streaky vs metronomic.
pricePerformance: what this data suggests about price versus output — which price brackets tend to overperform or underperform, including under-the-radar players outside the usual premium names.
earlyLate: concrete differences between early-season and late-season output — which players or types of players tend to start fast and fade, or start slow and finish strong.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      // Opus 5 thinks by default and max_tokens caps thinking + the visible
      // answer together. With all 500+-minute players in scope (~650 rows,
      // not just the top 80), the input is much larger and needs real
      // headroom for both thinking and the structured four-section answer.
      max_tokens: 12000,
      output_config: { format: { type: "json_schema", schema: trendsSchema } },
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = JSON.parse(rawText);

    return NextResponse.json({
      ...parsed,
      meta: {
        generatedAt: digest.generatedAt,
        seasons: digest.seasons,
        playersInDigest: digest.playersInDigest,
        totalPlayersConsidered: digest.totalPlayersConsidered,
      },
    });
  } catch (error) {
    console.error("Failed to generate trend analysis", error);
    return NextResponse.json(
      { error: "Could not generate trend analysis right now. Try again shortly." },
      { status: 502 },
    );
  }
}
