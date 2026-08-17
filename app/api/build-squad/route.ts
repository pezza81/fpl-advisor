import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildAllPlayers, fetchBootstrapStatic } from "@/lib/fpl";
import { buildShortlist, greedyBuildSquad, scorePlayers, type ScoredPlayer } from "@/lib/squad-builder";
import { isRuleCompliantSquad, MAX_PER_CLUB, POSITION_QUOTAS, SQUAD_BUDGET } from "@/lib/squad-rules";
import { extractJsonObject } from "@/lib/text";

const FALLBACK_RATIONALE =
  "Built automatically from our value model — season points, 3-season trend direction and each club's real xG attacking/defensive strength, weighted per player and picked by price efficiency within the £100m budget and squad rules.";

const POSITION_LABELS: Record<string, string> = {
  GKP: "GOALKEEPERS",
  DEF: "DEFENDERS",
  MID: "MIDFIELDERS",
  FWD: "FORWARDS",
};

function formatShortlistForPrompt(shortlist: Record<string, ScoredPlayer[]>): string {
  return Object.entries(POSITION_QUOTAS)
    .map(([position, quota]) => {
      const label = POSITION_LABELS[position] ?? position;
      const rows = (shortlist[position] ?? []).map((p) => {
        const rankText =
          p.relevantRank != null
            ? `${p.position === "GKP" || p.position === "DEF" ? "defense" : "attack"} rank ${p.relevantRank}/${p.rankTotal}`
            : "no team xG data";
        return `id ${p.id} | ${p.name} (${p.club}) | £${p.price}m | form ${p.form} | ${p.totalPoints} pts | trend: ${p.trendDirection} | ${rankText} | value ${p.valueScore.toFixed(1)}`;
      });
      return `${label} (pick exactly ${quota}):\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

function buildPrompt(shortlist: Record<string, ScoredPlayer[]>): string {
  return `You are building an optimal 15-player Fantasy Premier League squad from scratch, working strictly from the candidate list below (do not use any player not listed here).

Candidates (id | name (club) | price | current form | season points so far | 3-season output trend | club's real xG-based league rank for the relevant side of the ball | value = a composite score already blending points, trend and team xG strength, divided by price):

${formatShortlistForPrompt(shortlist)}

Rules (all must hold):
- Exactly 15 players: 2 goalkeepers, 5 defenders, 5 midfielders, 3 forwards.
- Total price must not exceed £${SQUAD_BUDGET}m.
- No more than ${MAX_PER_CLUB} players from the same club.
- Every id must come from the candidate list above.

Pick for the best realistic squad, not just the highest "value" number in isolation — balance a few premium performers with efficient, trend-positive picks so the whole squad is strong, and don't dump the entire budget into one position. Use the trend and team xG rank columns as real evidence, not just price and points.

Respond with ONLY a single JSON object, no markdown, no code fences, no text outside the JSON:
{"picks": [15 numbers, the chosen ids], "rationale": "3-5 sentences explaining the squad's shape and citing specific trend and xG evidence for a couple of the key picks"}`;
}

interface ParsedResponse {
  picks?: unknown;
  rationale?: unknown;
}

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "placeholder") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  let bootstrap;
  try {
    bootstrap = await fetchBootstrapStatic();
  } catch (error) {
    console.error("Failed to load FPL bootstrap data for squad builder", error);
    return NextResponse.json(
      { error: "Could not load player data. Try again shortly." },
      { status: 502 },
    );
  }

  const allPlayers = buildAllPlayers(bootstrap);
  const scored = await scorePlayers(allPlayers);
  const shortlist = buildShortlist(scored);
  const byId = new Map(scored.map((p) => [p.id, p]));

  const client = new Anthropic({ apiKey });
  let picks: ScoredPlayer[] | null = null;
  let rationale = "";

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      // Constraint-satisfaction over a ~150-candidate shortlist plus a
      // rationale needs real headroom on top of Opus 5's default thinking.
      max_tokens: 6144,
      messages: [{ role: "user", content: buildPrompt(shortlist) }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = extractJsonObject(rawText) as ParsedResponse | null;

    if (parsed && Array.isArray(parsed.picks)) {
      const resolved = parsed.picks
        .filter((id): id is number => typeof id === "number")
        .map((id) => byId.get(id))
        .filter((p): p is ScoredPlayer => p != null);
      const deduped = Array.from(new Map(resolved.map((p) => [p.id, p])).values());

      if (isRuleCompliantSquad(deduped)) {
        picks = deduped;
        rationale = typeof parsed.rationale === "string" ? parsed.rationale : FALLBACK_RATIONALE;
      }
    }
  } catch (error) {
    console.error("Claude squad suggestion failed, falling back to the value-model builder", error);
  }

  let usedFallback = false;
  if (!picks) {
    usedFallback = true;
    picks = greedyBuildSquad(scored);
    rationale = FALLBACK_RATIONALE;
  }

  return NextResponse.json({ squad: picks, rationale, usedFallback });
}
