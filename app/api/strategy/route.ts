import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fetchBootstrapStatic, type FplElement } from "@/lib/fpl";

const TOP_MANAGERS_PATH = path.join(process.cwd(), "data", "top-managers", "summary.json");

interface TopManagerEntry {
  elementId: number;
  name: string;
  club: string;
  count: number;
  percent: number;
}

interface TopManagersSummary {
  generatedAt: string;
  gameweek: number;
  requestedCount: number;
  sampleSize: number;
  averageSquadValue: number | null;
  averageBank: number | null;
  mostOwned: TopManagerEntry[];
  mostCaptained: TopManagerEntry[];
}

async function loadTopManagersSummary(): Promise<TopManagersSummary | null> {
  try {
    const raw = await readFile(TOP_MANAGERS_PATH, "utf8");
    return JSON.parse(raw) as TopManagersSummary;
  } catch {
    // Not yet scraped (npm run fetch:top-managers) — the page shows an
    // explanatory empty state rather than failing outright.
    return null;
  }
}

const POSITION_LABELS: Record<number, string> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_ORDER = ["GKP", "DEF", "MID", "FWD"];

function buildPointsByPosition(elements: FplElement[]) {
  const stats = new Map<string, { pointsSum: number; count: number }>();
  for (const element of elements) {
    const position = POSITION_LABELS[element.element_type] ?? "?";
    const entry = stats.get(position) ?? { pointsSum: 0, count: 0 };
    entry.pointsSum += element.total_points;
    entry.count += 1;
    stats.set(position, entry);
  }

  return POSITION_ORDER.map((position) => {
    const stat = stats.get(position);
    return {
      position,
      averagePoints: stat && stat.count > 0 ? Math.round((stat.pointsSum / stat.count) * 10) / 10 : 0,
      playerCount: stat?.count ?? 0,
    };
  });
}

function buildValuePicks(elements: FplElement[]) {
  return elements
    .filter((element) => element.now_cost >= 50 && element.now_cost <= 70 && element.minutes > 0)
    .map((element) => ({
      name: element.web_name,
      price: element.now_cost / 10,
      totalPoints: element.total_points,
      pointsPerMillion: Math.round((element.total_points / (element.now_cost / 10)) * 10) / 10,
      position: POSITION_LABELS[element.element_type] ?? "?",
    }))
    .sort((a, b) => b.pointsPerMillion - a.pointsPerMillion)
    .slice(0, 5);
}

function buildPremiumPicks(elements: FplElement[]) {
  return elements
    .filter((element) => element.now_cost >= 100)
    .map((element) => ({
      name: element.web_name,
      price: element.now_cost / 10,
      totalPoints: element.total_points,
      position: POSITION_LABELS[element.element_type] ?? "?",
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, 5);
}

export async function GET() {
  try {
    const [bootstrap, topManagers] = await Promise.all([fetchBootstrapStatic(), loadTopManagersSummary()]);
    const elementsById = new Map(bootstrap.elements.map((element) => [element.id, element]));

    // The best-possible captain pick each finished gameweek this season —
    // using bootstrap's own top-scorer-per-gameweek field. This is
    // current-season only: the app's 3-season historical digest is season
    // aggregates (goals/assists totals), not gameweek-level data, so there's
    // no real "3-season best captain by gameweek" to draw from.
    const bestScorersByGameweek = bootstrap.events
      .filter((event) => event.finished && event.top_element_info)
      .map((event) => {
        const element = event.top_element_info ? elementsById.get(event.top_element_info.id) : undefined;
        return {
          gameweek: event.id,
          name: element?.web_name ?? "Unknown",
          points: event.top_element_info?.points ?? 0,
        };
      })
      .sort((a, b) => a.gameweek - b.gameweek);

    return NextResponse.json(
      {
        pointsByPosition: buildPointsByPosition(bootstrap.elements),
        valuePicks: buildValuePicks(bootstrap.elements),
        premiumPicks: buildPremiumPicks(bootstrap.elements),
        bestScorersByGameweek,
        topManagers,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Failed to build strategy data", error);
    return NextResponse.json(
      { error: "Could not load strategy data right now. Try again shortly." },
      { status: 502 },
    );
  }
}
