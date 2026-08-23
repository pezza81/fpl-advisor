// One-off / periodically re-run data pull.
//
// Scrapes player-level xG data from Understat.com for the current Premier
// League season. Understat has no documented public API — this hits the
// same internal `getLeagueData` endpoint its own league page's client-side
// JS calls to populate the players table (the page used to embed the data
// directly as an escaped JSON blob in a <script> tag, a well-known scraping
// trick, but that no longer applies now that it's fetched via XHR instead;
// found by inspecting the page's own network requests).
//
// Usage: npm run fetch:understat

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "data", "understat");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return res.text();
}

// Understat's own season dropdown always marks the current season with
// `selected` — reading it here instead of hardcoding a year keeps this
// script working after each summer's season rollover with no code change.
async function detectCurrentSeason() {
  const html = await fetchText("https://understat.com/league/EPL");
  const match = html.match(/<option value="(\d{4})"\s+selected\s*>/);
  if (!match) {
    throw new Error("Could not detect the current season from Understat's league page — page layout may have changed.");
  }
  return match[1];
}

function toNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Per-90 rate, guarding the obvious divide-by-zero for a player with 0
// minutes this season.
function perNinety(total, minutes) {
  if (!minutes) return 0;
  return round2(total / (minutes / 90));
}

function mapPlayer(raw) {
  const minutes = toInt(raw.time);
  const xG = toNumber(raw.xG);
  const xA = toNumber(raw.xA);

  return {
    name: raw.player_name,
    team: raw.team_title,
    position: raw.position,
    games: toInt(raw.games),
    minutes,
    goals: toInt(raw.goals),
    assists: toInt(raw.assists),
    xG: round2(xG),
    xA: round2(xA),
    npxG: round2(toNumber(raw.npxG)),
    shots: toInt(raw.shots),
    keyPasses: toInt(raw.key_passes),
    xG90: perNinety(xG, minutes),
    xA90: perNinety(xA, minutes),
  };
}

async function main() {
  const startedAt = Date.now();

  const season = await detectCurrentSeason();
  console.log(`Detected current Understat season: ${season}/${Number(season) + 1}`);

  console.log("Fetching player-level xG data...");
  const raw = await fetchText(`https://understat.com/getLeagueData/EPL/${season}`);
  const data = JSON.parse(raw);

  if (!Array.isArray(data.players)) {
    throw new Error("Unexpected response shape from Understat — no players array found.");
  }

  const players = data.players.map(mapPlayer).sort((a, b) => b.xG - a.xG);

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, "players.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "https://understat.com",
        league: "EPL",
        season,
        players,
      },
      null,
      2,
    ),
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`Done in ${elapsedSec}s. Wrote ${players.length} players to ${outPath}`);
}

main().catch((error) => {
  console.error("Understat fetch failed:", error);
  process.exit(1);
});
