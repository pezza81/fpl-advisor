// One-off / periodically re-run data pull.
//
// Pulls the top N managers from FPL's "Overall" global classic league
// (league id 314 — the same one FPL's own site links to as the overall
// world ranking) and their current gameweek squads, then aggregates what
// they have in common: most-owned players, most-captained players, average
// squad value/bank. Feeds the "What the best managers are doing" section on
// /strategy.
//
// This is a genuinely large pull — up to 20 standings pages plus one picks
// request per manager (1000 by default) — so it runs offline like the
// other fetch:* scripts rather than being computed live on page load.
//
// Usage: npm run fetch:top-managers [-- --count=1000]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FPL_BASE = "https://fantasy.premierleague.com/api";
const LEAGUE_ID = 314; // FPL's official "Overall" global league
const PAGE_SIZE = 50;
const DEFAULT_COUNT = 1000;
const CONCURRENCY = 5;
const BATCH_PAUSE_MS = 500;

const OUT_DIR = path.join(process.cwd(), "data", "top-managers");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fplGet(pathSuffix) {
  const res = await fetch(`${FPL_BASE}${pathSuffix}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${pathSuffix}`);
  }
  return res.json();
}

// Runs `fn` over `items` with bounded concurrency, pausing between batches
// — a single manager's picks fetch failing (private/banned account, no
// squad set) shouldn't abort the whole run, hence allSettled.
async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.allSettled(batch.map((item) => fn(item)));
    results.push(...batchResults);
    if (i + limit < items.length) await sleep(BATCH_PAUSE_MS);
  }
  return results;
}

function parseCount() {
  const arg = process.argv.find((a) => a.startsWith("--count="));
  if (!arg) return DEFAULT_COUNT;
  const n = Number.parseInt(arg.split("=")[1], 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COUNT;
}

async function fetchTopManagerIds(count) {
  const pages = Math.ceil(count / PAGE_SIZE);
  const ids = [];
  for (let page = 1; page <= pages; page++) {
    console.log(`Fetching standings page ${page}/${pages}...`);
    const data = await fplGet(`/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}`);
    for (const row of data.standings.results) {
      ids.push(row.entry);
      if (ids.length >= count) break;
    }
    if (ids.length >= count || !data.standings.has_next) break;
  }
  return ids.slice(0, count);
}

function topN(counts, elementsById, teamsById, sampleSize, n) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([elementId, count]) => {
      const element = elementsById.get(elementId);
      const club = element ? teamsById.get(element.team) : undefined;
      return {
        elementId,
        name: element?.web_name ?? "Unknown",
        club: club?.short_name ?? "?",
        count,
        percent: sampleSize > 0 ? Math.round((count / sampleSize) * 1000) / 10 : 0,
      };
    });
}

async function main() {
  const count = parseCount();
  const startedAt = Date.now();

  console.log("Fetching bootstrap data...");
  const bootstrap = await fplGet("/bootstrap-static/");
  const elementsById = new Map(bootstrap.elements.map((el) => [el.id, el]));
  const teamsById = new Map(bootstrap.teams.map((team) => [team.id, team]));
  const currentEvent =
    bootstrap.events.find((e) => e.is_current) ?? bootstrap.events.find((e) => e.is_previous);
  const gameweek = currentEvent ? currentEvent.id : 1;

  console.log(`Fetching top ${count} manager ids from the Overall league (id ${LEAGUE_ID})...`);
  const managerIds = await fetchTopManagerIds(count);
  console.log(`Got ${managerIds.length} manager ids. Fetching their gameweek ${gameweek} picks...`);

  const ownershipCounts = new Map();
  const captainCounts = new Map();
  let squadValueSum = 0;
  let bankSum = 0;
  let sampleSize = 0;

  const results = await mapWithConcurrency(managerIds, CONCURRENCY, (id) =>
    fplGet(`/entry/${id}/event/${gameweek}/picks/`),
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const data = result.value;
    if (!Array.isArray(data.picks) || !data.entry_history) continue;

    sampleSize++;
    squadValueSum += data.entry_history.value / 10;
    bankSum += data.entry_history.bank / 10;

    for (const pick of data.picks) {
      ownershipCounts.set(pick.element, (ownershipCounts.get(pick.element) ?? 0) + 1);
      if (pick.is_captain) {
        captainCounts.set(pick.element, (captainCounts.get(pick.element) ?? 0) + 1);
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    leagueId: LEAGUE_ID,
    gameweek,
    requestedCount: count,
    sampleSize,
    averageSquadValue: sampleSize > 0 ? Math.round((squadValueSum / sampleSize) * 10) / 10 : null,
    averageBank: sampleSize > 0 ? Math.round((bankSum / sampleSize) * 10) / 10 : null,
    mostOwned: topN(ownershipCounts, elementsById, teamsById, sampleSize, 15),
    mostCaptained: topN(captainCounts, elementsById, teamsById, sampleSize, 10),
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, "summary.json");
  await writeFile(outPath, JSON.stringify(summary, null, 2));

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Done in ${elapsedSec}s. Sampled ${sampleSize}/${managerIds.length} managers successfully.\nWrote ${outPath}`,
  );
}

main().catch((error) => {
  console.error("Fetch failed:", error);
  process.exit(1);
});
