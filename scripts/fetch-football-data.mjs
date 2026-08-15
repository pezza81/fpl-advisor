// One-off / periodically re-run data pull.
//
// Pulls 3 completed Premier League seasons from API-Football (https://www.api-football.com/)
// and stores a trimmed, digest-ready copy under data/football/.
//
// Usage: npm run fetch:football
// Requires API_FOOTBALL_KEY in the environment (loaded from .env.local via --env-file).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_BASE = "https://v3.football.api-sports.io";
const API_KEY = process.env.API_FOOTBALL_KEY;
const LEAGUE_ID = 39; // Premier League
const SEASONS = [2023, 2024, 2025]; // last 3 completed seasons
const EARLY_ROUNDS = [1, 2, 3, 4, 5, 6];
const LATE_ROUNDS = [33, 34, 35, 36, 37, 38];
const CONCURRENCY = 3;
const BATCH_PAUSE_MS = 1800; // keeps us well under the 300 req/min plan limit
const PHASE_PAUSE_MS = 3000; // extra breathing room between request phases

const OUT_DIR = path.join(process.cwd(), "data", "football");

if (!API_KEY) {
  console.error("Missing API_FOOTBALL_KEY in the environment. Aborting.");
  process.exit(1);
}

let requestCount = 0;

function hasApiErrors(json) {
  return Array.isArray(json.errors) ? json.errors.length > 0 : Object.keys(json.errors ?? {}).length > 0;
}

function isRateLimitError(json) {
  return JSON.stringify(json.errors ?? {}).toLowerCase().includes("rate");
}

async function apiGet(pathname, params) {
  const url = new URL(`${API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    requestCount++;
    const res = await fetch(url, {
      headers: { "x-apisports-key": API_KEY },
    });

    // API-Football signals its per-minute rate limit as HTTP 200 with a
    // populated `errors.rateLimit` field, not an HTTP 429 — so both cases
    // need the same retry/backoff path.
    if (res.ok) {
      const json = await res.json();
      if (hasApiErrors(json)) {
        if (isRateLimitError(json) && attempt < MAX_ATTEMPTS) {
          const wait = 4000 * attempt;
          console.warn(`  Rate limited on ${pathname}, backing off ${wait}ms (attempt ${attempt})...`);
          await sleep(wait);
          continue;
        }
        throw new Error(`API error for ${url}: ${JSON.stringify(json.errors)}`);
      }
      return json;
    }

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const wait = 4000 * attempt;
      console.warn(`  HTTP 429 on ${pathname}, backing off ${wait}ms...`);
      await sleep(wait);
      continue;
    }

    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  throw new Error(`Exhausted retries for ${pathname}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs `fn` over `items` with bounded concurrency, pausing between batches
// to stay comfortably under the API's per-minute rate limit.
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((item) => fn(item)));
    results.push(...batchResults);
    if (i + limit < items.length) await sleep(BATCH_PAUSE_MS);
  }
  return results;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Non-letters (hyphens, apostrophes, dots) become spaces rather than being
    // dropped outright, so "Solanke-Mitchell" -> "solanke mitchell" instead of
    // the two words silently fusing into "solankemitchell".
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// FPL's `web_name` is a short display surname (closer to how API-Football
// names players) while `second_name` is the full legal surname, which is
// often multi-word for Portuguese/Spanish/Brazilian players. Try a few
// candidate forms on each side so "A. Mac Allister" (API-Football) still
// finds "Mac Allister" (FPL web_name) despite the leading initial.
function stripLeadingInitial(name) {
  return name.replace(/^[A-Za-zÀ-ÿ]\.\s*/, "");
}

function candidateSurnames(fullName) {
  const stripped = stripLeadingInitial(fullName);
  const words = normalizeName(stripped).split(" ").filter(Boolean);
  const candidates = new Set([normalizeName(stripped)]);
  if (words.length >= 1) candidates.add(words.at(-1));
  if (words.length >= 2) candidates.add(words.slice(-2).join(" "));
  return [...candidates];
}

function mapPlayerStat(entry, season) {
  const stats = entry.statistics?.[0];
  if (!stats) return null;

  return {
    playerId: entry.player.id,
    name: entry.player.name,
    age: entry.player.age,
    nationality: entry.player.nationality,
    teamId: stats.team?.id ?? null,
    teamName: stats.team?.name ?? null,
    position: stats.games?.position ?? "Unknown",
    season,
    appearances: stats.games?.appearences ?? 0,
    lineups: stats.games?.lineups ?? 0,
    minutes: stats.games?.minutes ?? 0,
    rating: stats.games?.rating ? Number.parseFloat(stats.games.rating) : null,
    goals: stats.goals?.total ?? 0,
    assists: stats.goals?.assists ?? 0,
    yellowCards: stats.cards?.yellow ?? 0,
    redCards: stats.cards?.red ?? 0,
  };
}

async function fetchSeasonPlayerStats(season) {
  console.log(`[${season}] Fetching season player stats...`);
  const first = await apiGet("/players", { league: LEAGUE_ID, season, page: 1 });
  const totalPages = first.paging.total;
  const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

  const restPages = await mapWithConcurrency(pages, CONCURRENCY, (page) =>
    apiGet("/players", { league: LEAGUE_ID, season, page }),
  );

  const allResponses = [first, ...restPages];
  const players = allResponses
    .flatMap((page) => page.response)
    .map((entry) => mapPlayerStat(entry, season))
    .filter((p) => p !== null);

  console.log(`[${season}] ${players.length} player-season records across ${totalPages} pages.`);
  return players;
}

async function fetchSeasonFixtures(season) {
  console.log(`[${season}] Fetching fixture calendar...`);
  const data = await apiGet("/fixtures", { league: LEAGUE_ID, season });
  return data.response.map((f) => ({
    fixtureId: f.fixture.id,
    date: f.fixture.date,
    round: f.league.round,
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeGoals: f.goals.home,
    awayGoals: f.goals.away,
  }));
}

function roundNumber(roundLabel) {
  const match = /Regular Season - (\d+)/.exec(roundLabel);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function fetchGoalEvents(season, fixtures) {
  const early = fixtures.filter((f) => EARLY_ROUNDS.includes(roundNumber(f.round)));
  const late = fixtures.filter((f) => LATE_ROUNDS.includes(roundNumber(f.round)));
  const targeted = [
    ...early.map((f) => ({ ...f, window: "early" })),
    ...late.map((f) => ({ ...f, window: "late" })),
  ];

  console.log(
    `[${season}] Fetching goal/assist events for ${targeted.length} fixtures (rounds ${EARLY_ROUNDS[0]}-${EARLY_ROUNDS.at(-1)} & ${LATE_ROUNDS[0]}-${LATE_ROUNDS.at(-1)})...`,
  );

  const perFixture = await mapWithConcurrency(targeted, CONCURRENCY, async (fixture) => {
    const data = await apiGet("/fixtures/events", { fixture: fixture.fixtureId });
    return data.response
      .filter((event) => event.type === "Goal")
      .map((event) => ({
        season,
        window: fixture.window,
        fixtureId: fixture.fixtureId,
        round: fixture.round,
        date: fixture.date,
        minute: event.time.elapsed,
        teamName: event.team.name,
        scorerId: event.player.id,
        scorerName: event.player.name,
        assistId: event.assist?.id ?? null,
        assistName: event.assist?.name ?? null,
        detail: event.detail,
      }));
  });

  return perFixture.flat();
}

async function fetchFplPrices() {
  console.log("Fetching current FPL prices for the price-vs-performance merge...");
  const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const data = await res.json();
  return data.elements.map((el) => ({
    webName: el.web_name,
    fullName: `${el.first_name} ${el.second_name}`,
    price: el.now_cost / 10,
    form: Number.parseFloat(el.form) || 0,
  }));
}

function buildDigest(seasonStats, seasonEvents, fplPrices) {
  const byPlayer = new Map();

  for (const record of seasonStats) {
    if (!byPlayer.has(record.playerId)) {
      byPlayer.set(record.playerId, {
        playerId: record.playerId,
        name: record.name,
        nationality: record.nationality,
        bySeason: {},
      });
    }
    const player = byPlayer.get(record.playerId);
    player.position = record.position; // most recently seen position wins
    player.teamName = record.teamName;
    player.bySeason[record.season] = {
      team: record.teamName,
      position: record.position,
      appearances: record.appearances,
      minutes: record.minutes,
      rating: record.rating,
      goals: record.goals,
      assists: record.assists,
      yellowCards: record.yellowCards,
      redCards: record.redCards,
      earlyGoals: 0,
      earlyAssists: 0,
      lateGoals: 0,
      lateAssists: 0,
    };
  }

  for (const event of seasonEvents) {
    const seasonBucket = (playerId, field) => {
      const player = byPlayer.get(playerId);
      const season = player?.bySeason[event.season];
      if (season) season[field] += 1;
    };
    seasonBucket(event.scorerId, event.window === "early" ? "earlyGoals" : "lateGoals");
    if (event.assistId) {
      seasonBucket(event.assistId, event.window === "early" ? "earlyAssists" : "lateAssists");
    }
  }

  // Two lookup tiers: web_name is FPL's short display surname (best match
  // against API-Football's own short names); full name is the fallback.
  const priceByWebName = new Map();
  const priceByFullName = new Map();
  for (const p of fplPrices) {
    for (const key of candidateSurnames(p.webName)) priceByWebName.set(key, p);
    priceByFullName.set(normalizeName(p.fullName), p);
  }

  function findPriceMatch(apiFootballName) {
    for (const candidate of candidateSurnames(apiFootballName)) {
      const hit = priceByWebName.get(candidate);
      if (hit) return hit;
    }
    return priceByFullName.get(normalizeName(stripLeadingInitial(apiFootballName)));
  }

  const players = [...byPlayer.values()].map((player) => {
    const totalMinutes = Object.values(player.bySeason).reduce((sum, s) => sum + s.minutes, 0);
    const totalGoalsAssists = Object.values(player.bySeason).reduce(
      (sum, s) => sum + s.goals + s.assists,
      0,
    );
    const priceMatch = findPriceMatch(player.name);

    return {
      ...player,
      totalMinutes,
      totalGoalsAssists,
      currentPrice: priceMatch?.price ?? null,
      currentForm: priceMatch?.form ?? null,
      // FPL's own web_name — the exact string the rest of the app (squad
      // pages, advice prompts) uses to display and identify this player, so
      // it's the reliable join key back to this digest record.
      fplWebName: priceMatch?.webName ?? null,
    };
  });

  // Keep everyone with meaningful game time across the 3-season window — a low
  // bar (roughly 6 full matches) so fringe/rotation players and hidden value
  // picks aren't filtered out, not just the top-output regulars. Sorted by
  // output mainly so the prompt reads star players first.
  const focused = players
    .filter((p) => p.totalMinutes >= 500)
    .sort((a, b) => b.totalGoalsAssists - a.totalGoalsAssists);

  return {
    generatedAt: new Date().toISOString(),
    leagueId: LEAGUE_ID,
    seasons: SEASONS,
    earlyRounds: EARLY_ROUNDS,
    lateRounds: LATE_ROUNDS,
    totalPlayersConsidered: players.length,
    playersInDigest: focused.length,
    players: focused,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const startedAt = Date.now();
  await mkdir(OUT_DIR, { recursive: true });

  const allSeasonStats = [];
  const allSeasonEvents = [];

  for (const season of SEASONS) {
    const statsPath = path.join(OUT_DIR, `players-${season}.json`);
    let stats = await readJsonIfExists(statsPath);
    if (stats) {
      console.log(`[${season}] Reusing cached player stats (${stats.length} records).`);
    } else {
      stats = await fetchSeasonPlayerStats(season);
      await writeFile(statsPath, JSON.stringify(stats, null, 2));
    }
    allSeasonStats.push(...stats);
    await sleep(PHASE_PAUSE_MS);

    const fixturesPath = path.join(OUT_DIR, `fixtures-${season}.json`);
    let fixtures = await readJsonIfExists(fixturesPath);
    if (fixtures) {
      console.log(`[${season}] Reusing cached fixture calendar (${fixtures.length} fixtures).`);
    } else {
      fixtures = await fetchSeasonFixtures(season);
      await writeFile(fixturesPath, JSON.stringify(fixtures, null, 2));
    }
    await sleep(PHASE_PAUSE_MS);

    const eventsPath = path.join(OUT_DIR, `goal-events-${season}.json`);
    let events = await readJsonIfExists(eventsPath);
    if (events) {
      console.log(`[${season}] Reusing cached goal/assist events (${events.length} events).`);
    } else {
      events = await fetchGoalEvents(season, fixtures);
      await writeFile(eventsPath, JSON.stringify(events, null, 2));
    }
    allSeasonEvents.push(...events);
    await sleep(PHASE_PAUSE_MS);
  }

  const fplPrices = await fetchFplPrices();
  const digest = buildDigest(allSeasonStats, allSeasonEvents, fplPrices);
  await writeFile(path.join(OUT_DIR, "digest.json"), JSON.stringify(digest, null, 2));

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nDone in ${elapsedSec}s using ${requestCount} API requests.\n` +
      `Digest: ${digest.playersInDigest} players (of ${digest.totalPlayersConsidered} considered) ` +
      `across seasons ${SEASONS.join(", ")}.\n` +
      `Files written to ${OUT_DIR}`,
  );
}

main().catch((error) => {
  console.error("Fetch failed:", error);
  process.exit(1);
});
