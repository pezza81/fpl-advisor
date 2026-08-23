import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { EARLY_SEASON_CUTOFF_GAMEWEEK, fetchBootstrapStatic, type SquadPlayer } from "@/lib/fpl";
import {
  buildFplNameLookup,
  classifyTrend,
  findRisingCandidates,
  formatTrendLine,
  loadFootballDigest,
} from "@/lib/football-trends";
import { splitLabeledSections } from "@/lib/text";
import {
  fplClubToTeamName,
  getLeagueStrengthRankings,
  getRestDaysImpact,
  getTeamRollingForm,
  restBucketFor,
  REST_BUCKET_LABELS,
} from "@/lib/team-stats";
import {
  getClubRestDays,
  getHeadToHeadForClub,
  getInjuryForPlayer,
  getLineupStatusForPlayer,
  preloadMatchContextCache,
} from "@/lib/api-football";
import { chipExplanationFor } from "@/lib/chips";
import { getPlayerXG, type UnderstatPlayer } from "@/lib/understat";

interface AdviceChip {
  name: string;
  label: string;
}

interface AdviceRequestBody {
  teamName?: string;
  gameweek?: number;
  bank?: number;
  squadValue?: number;
  squad?: SquadPlayer[];
  availableChips?: AdviceChip[];
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

// Real match-level xG/xGoT/Pressure Index data (Sportmonks, via the shared
// football-data-collector DB) for each club represented in the squad —
// prompt-ready text so advice can cite actual defensive/attacking strength
// rather than just FPL's own fixture difficulty ratings. Synchronous
// (better-sqlite3) but still wrapped defensively: the DB lives outside this
// repo and advice generation shouldn't break if it's ever unreachable.
function buildTeamStatsContext(squad: SquadPlayer[]): string {
  try {
    const rankings = getLeagueStrengthRankings();
    const rankByTeam = new Map(rankings.map((r) => [r.teamName, r]));
    const clubCodes = Array.from(new Set(squad.map((player) => player.club)));

    const lines = clubCodes
      .map((clubCode) => {
        const teamName = fplClubToTeamName(clubCode);
        if (!teamName) return null;
        const form = getTeamRollingForm(teamName, 5);
        if (!form) return null;

        const rank = rankByTeam.get(teamName);
        const rankNote = rank
          ? ` — ranked ${rank.defenseRank}/${rankings.length} for defense and ${rank.attackRank}/${rankings.length} for attack this season`
          : "";

        return `${teamName} (${clubCode}): last ${form.matchesPlayed} matches — ${form.xgFor} xG created, ${form.xgAgainst} xG conceded, ${form.xgotFor} xGoT for, ${form.xgotAgainst} xGoT against, pressure index ${form.pressureIndex} per game${rankNote}`;
      })
      .filter((line): line is string => line !== null);

    if (lines.length === 0) return "";

    return `\nReal match-level xG data for this squad's clubs (Sportmonks, last 5 matches per club, current-season league rankings out of ${rankings.length}):\n${lines.join("\n")}\n`;
  } catch (error) {
    console.error("Failed to load shared team-stats DB", error);
    return "";
  }
}

// Live availability (injury/suspension), expected-lineup and head-to-head
// data from API-Football — the strongest possible signal for whether a
// transfer is actually urgent (a declining trend is a reason to consider
// moving someone on; being injured or benched is a reason to do it now) and
// for whether a club's next fixture is a safe captaincy bet historically.
// Deliberately excludes "lineup unknown" as a flagged line — that's the
// default state most of the week and would just be prompt noise, not signal.
async function buildMatchStatusContext(squad: SquadPlayer[]): Promise<string> {
  try {
    await preloadMatchContextCache();

    const playerLines = (
      await Promise.all(
        squad.map(async (player) => {
          const [injury, lineup] = await Promise.all([
            getInjuryForPlayer(player.club, player.name).catch(() => null),
            getLineupStatusForPlayer(player.club, player.name).catch(() => null),
          ]);

          if (!injury && lineup?.status !== "bench") return null;

          const parts: string[] = [];
          if (injury) {
            parts.push(`${injury.type} — ${injury.reason} (as of ${injury.asOf.slice(0, 10)})`);
          }
          if (lineup?.status === "bench") {
            parts.push(`expected on the BENCH for their next match vs ${lineup.opponentName}`);
          }

          return `${player.name} (${player.club}): ${parts.join("; ")}`;
        }),
      )
    ).filter((line): line is string => line !== null);

    const clubs = Array.from(new Set(squad.map((p) => p.club)));
    const h2hLines = (
      await Promise.all(
        clubs.map(async (club) => {
          const h2h = await getHeadToHeadForClub(club).catch(() => null);
          if (!h2h || h2h.played === 0) return null;
          return `${club} last ${h2h.played} vs ${h2h.opponentName}: ${h2h.wins}W ${h2h.draws}D ${h2h.losses}L, ${h2h.goalsFor}-${h2h.goalsAgainst} goals`;
        }),
      )
    ).filter((line): line is string => line !== null);

    if (playerLines.length === 0 && h2hLines.length === 0) return "";

    const injurySection =
      playerLines.length > 0
        ? `Players with a current injury/suspension designation or expected on the bench:\n${playerLines.join("\n")}`
        : "No squad player currently has an injury/suspension designation or a known bench status.";

    const h2hSection =
      h2hLines.length > 0
        ? `Head-to-head record vs each club's next opponent (last 5 meetings, API-Football):\n${h2hLines.join("\n")}`
        : "";

    return `\nLive injury, lineup and head-to-head data (API-Football):\n\n${injurySection}\n\n${h2hSection}\n`;
  } catch (error) {
    console.error("Failed to load API-Football match status context", error);
    return "";
  }
}

// Live rest-days-before-next-fixture per club (API-Football) cross-referenced
// against how that club has historically performed in the matching rest
// bracket (shared xG database) — so rotation-risk/freshness claims in the
// advice can cite real numbers instead of just a day count.
async function buildRestDaysContext(squad: SquadPlayer[]): Promise<string> {
  try {
    const clubs = Array.from(new Set(squad.map((p) => p.club)));

    const lines = (
      await Promise.all(
        clubs.map(async (club) => {
          const rest = await getClubRestDays(club).catch(() => null);
          if (!rest || rest.restDays == null) return null;

          let historicalNote = "";
          const teamName = fplClubToTeamName(club);
          if (teamName) {
            const bucket = restBucketFor(rest.restDays);
            const stats = getRestDaysImpact(teamName).find((b) => b.bucket === bucket);
            if (stats && stats.matches > 0) {
              historicalNote = ` — historically with ${REST_BUCKET_LABELS[bucket]} rest, they've averaged ${stats.avgXgFor} xG created and ${stats.avgXgAgainst} xG conceded per game (${stats.matches} matches on record)`;
            }
          }

          return `${club}: ${rest.restDays} days rest before their next fixture${historicalNote}`;
        }),
      )
    ).filter((line): line is string => line !== null);

    if (lines.length === 0) return "";

    return `\nRest days before each club's next fixture (API-Football, live) with historical xG performance in that rest bracket (shared database):\n${lines.join("\n")}\n`;
  } catch (error) {
    console.error("Failed to build rest-days context", error);
    return "";
  }
}

// Only relevant in the first EARLY_SEASON_CUTOFF_GAMEWEEK gameweeks: how
// many league games each squad player's club has played so far this season
// (FPL bootstrap's own `played` count per team). A club on 0-1 games hasn't
// given a player enough of a sample to judge fairly — the instruction below
// tells Claude not to treat that alone as a sell signal.
async function buildEarlySeasonGamesContext(
  squad: SquadPlayer[],
  gameweek: number | undefined,
): Promise<string> {
  if (!gameweek || gameweek > EARLY_SEASON_CUTOFF_GAMEWEEK) return "";

  try {
    const bootstrap = await fetchBootstrapStatic();
    const playedByClub = new Map(bootstrap.teams.map((team) => [team.short_name, team.played]));

    const lines = Array.from(new Set(squad.map((player) => player.club)))
      .map((club) => {
        const played = playedByClub.get(club);
        return played != null ? `${club}: ${played} game${played === 1 ? "" : "s"} played this season` : null;
      })
      .filter((line): line is string => line !== null);

    if (lines.length === 0) return "";

    return `\nGames played so far this season, per club in this squad (FPL bootstrap, gameweek ${gameweek}):\n${lines.join("\n")}\n`;
  } catch (error) {
    console.error("Failed to build early-season games-played context", error);
    return "";
  }
}

// Expected-vs-actual output (Understat) for each squad player, flagging only
// the ones whose gap is big enough to say something meaningful (at least a
// whole goal or assist away from what their chances/key passes support) —
// the regression signal the TRANSFER and CAPTAIN instructions below lean on:
// underperforming xG means a player has been unlucky and is "due" a return,
// while overperforming xG means their output has been running hotter than
// their underlying chances and is a real regression risk.
async function buildXGContext(squad: SquadPlayer[]): Promise<string> {
  try {
    const entries = await Promise.all(
      squad.map(async (player) => {
        const stats = await getPlayerXG(player.name);
        return stats ? { name: player.name, club: player.club, stats } : null;
      }),
    );

    const lines = entries
      .filter((entry): entry is { name: string; club: string; stats: UnderstatPlayer } => entry !== null)
      .map(({ name, club, stats }) => {
        const goalDiff = stats.goals - stats.xG;
        const assistDiff = stats.assists - stats.xA;
        const notes: string[] = [];
        if (goalDiff <= -1) notes.push("underperforming their xG — due a goal soon");
        else if (goalDiff >= 1) notes.push("overperforming their xG — a real regression risk");
        if (assistDiff <= -1) notes.push("underperforming their xA — due an assist soon");
        else if (assistDiff >= 1) notes.push("overperforming their xA — could regress on assists");
        if (notes.length === 0) return null;

        return `${name} (${club}): ${stats.goals} goals from ${stats.xG} xG, ${stats.assists} assists from ${stats.xA} xA over ${stats.games} game${stats.games === 1 ? "" : "s"} — ${notes.join("; ")}.`;
      })
      .filter((line): line is string => line !== null);

    if (lines.length === 0) return "";

    return `\nExpected-vs-actual output this season for this squad (Understat xG/xA data):\n${lines.join("\n")}\n`;
  } catch (error) {
    console.error("Failed to build xG context", error);
    return "";
  }
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

// Any chip the manager could play right now (per the FPL app's own chip
// windows) — surfaced explicitly so the CHIP section can give a real
// recommendation instead of the generic "consider a chip" footnote it'd
// otherwise default to with no chip-availability signal at all.
function buildChipContext(availableChips?: AdviceChip[]): string {
  if (!availableChips || availableChips.length === 0) return "";

  const lines = availableChips.map((chip) => {
    const info = chipExplanationFor(chip.name);
    return info
      ? `${chip.label}: ${info.description} ${info.whenToUse}`
      : `${chip.label}: available to play this gameweek.`;
  });

  return `\nChips available to play this gameweek (per this manager's own FPL chip windows):\n${lines.join("\n")}\n`;
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

  const { squad, teamName, gameweek, bank, squadValue, availableChips } = body;
  if (!squad || !Array.isArray(squad) || squad.length === 0) {
    return NextResponse.json(
      { error: "A non-empty squad array is required." },
      { status: 400 },
    );
  }

  const client = new Anthropic({ apiKey });
  const [trendContext, matchStatusContext, restDaysContext, earlySeasonGamesContext, xgContext] = await Promise.all([
    buildTrendContext(squad),
    buildMatchStatusContext(squad),
    buildRestDaysContext(squad),
    buildEarlySeasonGamesContext(squad, gameweek),
    buildXGContext(squad),
  ]);
  const teamStatsContext = buildTeamStatsContext(squad);
  const chipContext = buildChipContext(availableChips);

  const prompt = `You are a sharp, friendly Fantasy Premier League expert giving advice to a mate ahead of gameweek ${gameweek ?? "the next gameweek"}.

Team: ${teamName ?? "Unknown"}
Bank: £${bank ?? 0}m
Squad value: £${squadValue ?? 0}m

Current 15-man squad (position, name, club, price, form, total points, role):
${formatSquadForPrompt(squad)}
${trendContext}${teamStatsContext}${matchStatusContext}${restDaysContext}${earlySeasonGamesContext}${xgContext}${chipContext}
Give advice in plain English, written like a knowledgeable friend chatting over a pint — no markdown, no bullet points, no headers other than the four labels below, no asterisks. Keep the TRANSFER and CAPTAIN sections to two or three sentences each. ${chipContext ? "The CHIP section is different this week: see the dedicated instruction below." : "Keep the CHIP section to two or three sentences as well."}

${trendContext ? "Be trend-aware, not just form-aware: this week's form is a snapshot, the 3-season trend data above is the pattern behind it. If a squad player is flagged as declining, say so explicitly and treat that as a real reason to consider moving them on even if their current form looks okay. If a squad player is flagged as rising, that strengthens the case to keep or captain them. When recommending a transfer target, prefer someone from the trending-upward list if they fit the budget (bank plus a realistic sale price) and the position needed — name the specific trend evidence (e.g. \"his G+A jumped from X to Y last season\") rather than just their current form. Only fall back to reasoning from current price and form when the trend data doesn't cover a relevant player.\n\n" : ""}${teamStatsContext ? "Use the real xG data above to justify defensive picks (clean sheet potential for defenders/goalkeepers) and attacking picks (goal threat for midfielders/forwards) — cite the actual numbers (e.g. \"only 0.8 xG conceded per game in the last 5\") instead of vague statements like \"good fixtures\" or generic FPL fixture difficulty talk. A club ranked well for defense is a stronger case for captaining or keeping its defenders/goalkeeper; a club ranked well for attack strengthens the case for its midfielders/forwards. If a club isn't covered by this data, fall back to form and points as normal.\n\n" : ""}${matchStatusContext ? "The live injury/lineup/head-to-head data above is your strongest signal — weigh it above trend and form. If a squad player has a current injury or suspension designation, or is expected on the bench, flag that STRONGLY in the TRANSFER section and treat it as reason enough to move them on now, even if their trend and price look fine — a player who can't play is worth zero points regardless of underlying numbers. For the CAPTAIN section, factor in each candidate's head-to-head record against their next opponent: a poor recent head-to-head (more losses than wins, or conceding more than scoring) is a real reason to downgrade a captaincy pick even if their current form is good, and a strong head-to-head record reinforces a captaincy pick. If a club has no head-to-head data (e.g. newly promoted opponent), just reason from form and team strength as normal.\n\n" : ""}${restDaysContext ? "Rest days matter too: if a squad player's club has 3 days or fewer rest before their next fixture, flag it as a real rotation-risk factor in the TRANSFER section (fatigue increases injury and squad-rotation risk, and the historical xG-in-that-bracket number above shows whether it actually hurts this specific club's output) — cite the actual xG figures given rather than just saying \"short rest\". If a club has 7+ days rest, mention it as a freshness advantage worth factoring into the CAPTAIN pick, again citing the historical numbers if they support it. Don't invent a rest-days claim for a club not listed above.\n\n" : ""}${earlySeasonGamesContext ? `It's still early season (gameweek ${gameweek} of ${EARLY_SEASON_CUTOFF_GAMEWEEK}) — the games-played counts above show some of this squad's clubs have played only 0 or 1 league games so far, which isn't enough of a sample to fairly judge a player's form or underlying output yet. Do NOT recommend selling a squad player whose club has played 0 or 1 games this season on the basis of poor form, price, or underlying stats alone — that's premature this early. The ONLY valid reason to recommend selling such a player is a confirmed injury or suspension status flag (visible in the squad list or live injury data above); everything else about them should be treated as "too early to call" rather than a sell signal. Once a club has played 2 or more games, normal season-long form/trend reasoning applies as usual.\n\n` : ""}${xgContext ? "Use the xG/xA data above as a regression signal for both the TRANSFER and CAPTAIN calls. A player flagged as underperforming their xG or xA has been genuinely unlucky given the quality of chances they're getting — that's a real reason to hold or even captain them despite a modest points total so far, not a reason to sell, since positive regression (a goal or assist return) is statistically overdue. A player flagged as overperforming their xG or xA has been scoring or assisting at a rate their underlying chances don't support — treat that as a mild caution against captaining them or banking on the run continuing, even if their point total looks strong right now, though it's not on its own a reason to sell someone who's actually delivering points. Don't invent an xG claim for a squad player not listed above.\n\n" : ""}${chipContext ? "This manager has at least one chip available to play RIGHT NOW — treat the CHIP section as a genuine dedicated recommendation, not a brief footnote. Write five or six sentences that: name the specific available chip(s) listed above; give a clear, direct verdict on whether to play one this gameweek or hold off; explain exactly why, using that chip's own description above and this specific squad and gameweek (e.g. an injury crisis or bad fixture run for a wildcard, a nailed-on premium player with a great fixture for triple captain, a fully-fit strong bench for bench boost, a blank or double gameweek for free hit); and give a concrete estimate of the realistic extra points return playing it now could bring, or, if holding is the right call, what specific future gameweek or condition to wait for instead. If more than one chip is available, cover each by name rather than picking only one to discuss.\n\n" : ""}Respond with exactly four sections, each starting on its own line with the label followed by a colon, in this order:

TRANSFER: your recommendation on who to transfer out and in, or hold, and why.
CAPTAIN: your captain and vice-captain pick for this gameweek and why.
CHIP: whether to consider playing a chip (wildcard, bench boost, triple captain, free hit) this week or hold off, and why.
ACTIONS: no fewer than 3 and no more than 5 lines total — pick the most important actions only, one per line, no bullets, no numbering, no dashes, just the plain instruction. Use simple direct language a checklist would use, e.g. "Sell Kulusevski", "Buy a nailed-on £6.5m midfielder", "Captain Haaland this week", "Hold your chips". Each line must be a single concrete action, not a sentence of reasoning. Do not exceed 5 lines under any circumstances.`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-5",
      // Opus 5 thinks by default and max_tokens caps thinking + the visible
      // answer together. Cross-referencing squad + trend + xG + live
      // injury/lineup/h2h/rest-days data is a harder reasoning task than
      // plain squad advice, and a dedicated multi-sentence CHIP section adds
      // more visible output on top, so keep generous headroom.
      max_tokens: 7168,
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
