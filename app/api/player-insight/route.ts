import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildFplNameLookup, classifyTrend, loadFootballDigest } from "@/lib/football-trends";
import {
  classifyMinutesTrendFromHistory,
  classifyTrendFromHistory,
  fetchFplSeasonHistory,
  type FplMinutesTrend,
  type FplPlayerTrend,
  type FplSeasonRow,
} from "@/lib/fpl-history";
import { getPlayerMatchContext, type ClubRestDays, type PlayerMatchContext } from "@/lib/api-football";
import { fplClubToTeamName, getRestDaysImpact, restBucketFor, REST_BUCKET_LABELS } from "@/lib/team-stats";

// The API-Football digest keys seasons by numeric year (2024); FPL history
// keys them by "2024/25"-style labels. Converts a digest-sourced trend into
// the same shape classifyTrendFromHistory returns, so callers get one
// consistent type regardless of which source actually answered.
function normalizeDigestTrend(trend: {
  direction: "rising" | "declining" | "stable";
  latestSeason: number | null;
  previousSeason: number | null;
  latestOutput: number | null;
  previousOutput: number | null;
}): FplPlayerTrend {
  return {
    direction: trend.direction,
    latestSeason: trend.latestSeason != null ? String(trend.latestSeason) : null,
    previousSeason: trend.previousSeason != null ? String(trend.previousSeason) : null,
    latestOutput: trend.latestOutput,
    previousOutput: trend.previousOutput,
  };
}

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

function describeTrend(trend: FplPlayerTrend): string {
  if (trend.direction === "unknown") {
    return "No historical trend data is available for this player.";
  }
  if (trend.previousSeason == null || trend.latestSeason == null) {
    return "This player only has one season of historical data, not enough to call a trend.";
  }
  return `3-season trend: ${trend.previousSeason}: ${trend.previousOutput} combined goals+assists -> ${trend.latestSeason}: ${trend.latestOutput} combined goals+assists (${trend.direction}).`;
}

function describeMinutesTrend(trend: FplMinutesTrend): string {
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

// Injury/suspension, expected lineup and head-to-head context, as prompt
// text — degrades to plain "no data" lines rather than omitting the
// section, since a missing designation is itself a meaningful (good) signal.
function describeMatchContext(context: PlayerMatchContext): string {
  const lines: string[] = [];

  if (context.injury) {
    lines.push(
      `Injury/suspension (API-Football): ${context.injury.type} — ${context.injury.reason} (as of ${context.injury.asOf.slice(0, 10)}).`,
    );
  } else {
    lines.push("Injury/suspension (API-Football): no current designation.");
  }

  if (context.lineup) {
    const statusText =
      context.lineup.status === "starting"
        ? "expected to START"
        : context.lineup.status === "bench"
          ? "expected on the BENCH"
          : "lineup status unknown (not yet announced)";
    lines.push(
      `Next fixture: ${context.lineup.isHome ? "vs" : "at"} ${context.lineup.opponentName} on ${context.lineup.kickoff.slice(0, 10)} — ${statusText}.`,
    );
  }

  if (context.headToHead) {
    const h2h = context.headToHead;
    if (h2h.played > 0) {
      lines.push(
        `Team's last ${h2h.played} vs ${h2h.opponentName}: ${h2h.wins}W ${h2h.draws}D ${h2h.losses}L, ${h2h.goalsFor}-${h2h.goalsAgainst} goals.`,
      );
    } else {
      lines.push(`Team's head-to-head vs ${h2h.opponentName}: no recent meetings on record.`);
    }
  }

  return lines.join("\n");
}

// Live rest-days number (API-Football) cross-referenced against how this
// club has historically performed in that exact rest bucket (shared xG
// database) — gives the verdict real numbers to cite rather than just "they
// have short rest" with nothing to back it up.
function describeRestDays(club: string | undefined, restDays: ClubRestDays | null): string {
  if (!club || !restDays || restDays.restDays == null) return "";

  const days = restDays.restDays;
  let historicalLine = "";

  const teamName = fplClubToTeamName(club);
  if (teamName) {
    try {
      const bucket = restBucketFor(days);
      const stats = getRestDaysImpact(teamName).find((b) => b.bucket === bucket);
      if (stats && stats.matches > 0) {
        historicalLine = ` Historically with ${REST_BUCKET_LABELS[bucket]} rest, this club has averaged ${stats.avgXgFor} xG created and ${stats.avgXgAgainst} xG conceded per game (${stats.matches} matches on record in the shared database).`;
      }
    } catch (error) {
      console.error("Failed to load rest-days impact from shared DB", error);
    }
  }

  return `Rest before next fixture: ${days} days (${restDays.daysSinceLastMatch} days since their last match, ${restDays.daysUntilNextMatch} days until the next one).${historicalLine}`;
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

  const [digest, fplSeasons, matchContext] = await Promise.all([
    loadFootballDigest(),
    fetchFplSeasonHistory(id ?? 0),
    club
      ? getPlayerMatchContext(club, name).catch((error) => {
          console.error("Failed to load API-Football match context", error);
          return {
            injury: null,
            lineup: null,
            headToHead: null,
            restDays: null,
          } satisfies PlayerMatchContext;
        })
      : Promise.resolve({
          injury: null,
          lineup: null,
          headToHead: null,
          restDays: null,
        } satisfies PlayerMatchContext),
  ]);

  // Goal-involvement trend: FPL's own history is the primary source (exact
  // element-id match), since the API-Football digest only fuzzy-matches
  // ~65-75% of players by name — that gap was surfacing a false "No
  // Historical Data" badge for players the season table clearly has 2-3
  // seasons of data for. Only fall back to the digest when FPL history
  // itself has nothing to say (new signing, no minutes yet, etc).
  let trend: FplPlayerTrend = classifyTrendFromHistory(fplSeasons);
  if (trend.direction === "unknown" && digest) {
    const digestPlayer = buildFplNameLookup(digest).get(name.toLowerCase().trim());
    if (digestPlayer) {
      trend = normalizeDigestTrend(classifyTrend(digestPlayer));
    }
  }

  // Minutes trend comes from this player's own official FPL history (already
  // fetched above, matched by exact element id) rather than the API-Football
  // digest — that digest only fuzzy-matches ~65-75% of players by name, which
  // was showing "Minutes Unknown" for players the season table right below
  // clearly has real minutes for.
  const minutesTrend: FplMinutesTrend = classifyMinutesTrendFromHistory(fplSeasons);

  const client = new Anthropic({ apiKey });

  const prompt = `You are a concise Fantasy Premier League analyst. A user is looking at one player in their squad and wants a quick verdict on whether to keep them this season.

Player: ${name} (${position ?? "unknown position"}, ${club ?? "unknown club"})
Price: £${price ?? "?"}m
Current form: ${form ?? "?"}
Total points this season: ${totalPoints ?? "?"}
${news ? `Availability news: ${news}` : "No injury or availability concerns reported."}
${describeTrend(trend)}${describeMinutesTrend(minutesTrend)}

${describeSeasonHistory(position, fplSeasons)}

${describeMatchContext(matchContext)}
${describeRestDays(club, matchContext.restDays)}

Write a verdict on whether this player is worth keeping this season, structured as exactly 2 to 3 short paragraphs separated by a blank line (a real blank line between paragraphs, not just a sentence break) — for example, one paragraph weighing current form against the historical trend, and a second paragraph on the position-specific benchmark judgment and final call. Do not write one continuous block.

In the first paragraph, weigh their current form against the goal-involvement trend above — if the trend and current form agree, say so plainly; if they conflict, call that out and explain which signal you'd trust more. If minutes are declining even while returns hold up, treat that as a real rotation-risk warning. In the next paragraph, using the official season history, judge the player against a position-specific benchmark: for a goalkeeper or defender, is their clean-sheet rate strong for a side of their club's level; for any position, is their bonus-points rate high (a proxy for good underlying performances, not just end product) or low for a player at this price; for attacking players, are goals+assists strong relative to price. If there's a current injury/suspension designation or the player is expected on the bench, that overrides everything else — say so plainly and near the top, since a player who can't play is worth nothing regardless of trend or price. If their club has 3 days or fewer rest before the next fixture, flag it as a real rotation-risk factor and cite the historical xG-with-short-rest number if it's given above; if they have 7+ days rest, mention it as a freshness advantage the same way. Close with a direct call — keep, consider selling, or keep an eye on them. Name the actual numbers you're weighing throughout. Plain English, no markdown, no bullet points, no asterisks, write like a knowledgeable friend giving a direct opinion.`;

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

    return NextResponse.json({ trend, minutesTrend, fplSeasons, summary, matchContext });
  } catch (error) {
    console.error("Failed to generate player insight", error);
    return NextResponse.json(
      { error: "Could not generate a player insight right now. Try again shortly." },
      { status: 502 },
    );
  }
}
