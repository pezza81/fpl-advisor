"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { DEMO_TEAM_ID, formatRankWithTotal, rankPercentile } from "@/lib/fpl";
import type {
  DashboardData,
  DashboardLeague,
  SeasonHistoryRow,
  SquadHealthPlayer,
  WhatsHappeningTile,
} from "@/lib/dashboard-types";
import { countUnread } from "@/lib/league-chat-storage";
import { CHIP_EXPLANATIONS, chipExplanationFor } from "@/lib/chips";
import {
  loadBriefingSnapshot,
  loadLastVisitDate,
  saveBriefingSnapshot,
  saveLastVisitDate,
} from "@/lib/briefing-storage";
import { AdviceCard } from "@/components/AdviceCard";
import { ActionChecklist } from "@/components/ActionChecklist";

interface DashboardResponse extends DashboardData {
  error?: string;
}

interface AdviceResponse {
  transfer: string;
  captain: string;
  chip: string;
  actions: string[];
  error?: string;
}

interface AccuracyLogEntry {
  gameweek: number;
  recommendedCaptain: string | null;
  actualCaptain: string | null;
  points: number | null;
  followed: boolean | null;
  status: "pending" | "resolved";
  recordedAt: string;
}

// ---- small pure helpers ----------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not eligible",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function healthDotClasses(health: SquadHealthPlayer["health"]): string {
  if (health === "green") return "bg-emerald-400";
  if (health === "amber") return "bg-amber-400";
  return "bg-red-400";
}

function healthCardClasses(health: SquadHealthPlayer["health"]): string {
  if (health === "green") return "border-emerald-800/60 bg-emerald-950/10";
  if (health === "amber") return "border-amber-800/60 bg-amber-950/15";
  return "border-red-800/60 bg-red-950/15";
}

function trendGlyph(trend: SquadHealthPlayer["trend"]): string {
  if (trend === "rising") return "↑";
  if (trend === "declining") return "↓";
  if (trend === "stable") return "→";
  return "?";
}

function trendColorClass(trend: SquadHealthPlayer["trend"]): string {
  if (trend === "rising") return "text-emerald-400";
  if (trend === "declining") return "text-red-400";
  return "text-muted";
}

// A rough, explainable heuristic for "this bench player looks too good to be
// benched" — not injured/suspended (that already explains the benching) and
// either priced or owned like a first-choice pick rather than squad depth.
const BENCH_STARTER_PRICE_THRESHOLD = 5.5;
const BENCH_STARTER_OWNERSHIP_THRESHOLD = 10;

function looksLikeAStarter(player: SquadHealthPlayer): boolean {
  if (player.health === "red") return false;
  return player.price >= BENCH_STARTER_PRICE_THRESHOLD || player.selectedByPercent >= BENCH_STARTER_OWNERSHIP_THRESHOLD;
}

// Mirrors the 3 / 4-5 / 6+ day buckets used elsewhere in the app (see
// lib/team-stats.ts's restBucketFor) — kept local since this is a client
// component and that module touches the server-only shared SQLite DB.
function restBadgeClasses(days: number): string {
  if (days <= 3) return "bg-red-800/70 text-red-100";
  if (days <= 5) return "bg-amber-800/70 text-amber-100";
  return "bg-emerald-800/70 text-emerald-100";
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Deadline passed";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDeadlineDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUpdatedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Claude is asked to name specific players; this finds whichever squad
// player's name appears earliest in the captain prose and treats that as
// "who was recommended" — used both for the one-line priority summary and
// the accuracy tracker's "followed?" comparison.
function extractRecommendedCaptain(captainText: string, squad: SquadHealthPlayer[]): string | null {
  let best: { name: string; index: number } | null = null;
  const lowerText = captainText.toLowerCase();
  for (const player of squad) {
    const index = lowerText.indexOf(player.name.toLowerCase());
    if (index !== -1 && (best === null || index < best.index)) {
      best = { name: player.name, index };
    }
  }
  return best?.name ?? null;
}

function condenseToOneLine(text: string, maxLength = 170): string {
  const firstSentence = text.match(/^[^.!?]+[.!?]/)?.[0] ?? text;
  const trimmed = firstSentence.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trim()}…` : trimmed;
}

// ---- small components -------------------------------------------------------

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-card-border/70 bg-background/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

interface ActionAlert {
  id: string;
  tone: "red" | "amber" | "green";
  title: string;
  body: string;
  link?: { href: string; label: string };
}

// Pure derivation from already-fetched dashboard data — no chip/captain
// checks need their own state, they're just filters over dashboard.squad
// and dashboard.chips evaluated fresh on every render.
function buildActionCards(dashboard: DashboardData): ActionAlert[] {
  const cards: ActionAlert[] = [];

  const captain = dashboard.squad.find((player) => player.isCaptain);
  if (!captain) {
    cards.push({
      id: "captain-missing",
      tone: "red",
      title: "Set your captain before the deadline",
      body: "No captain is set for your squad. Pick one on the FPL site before the gameweek deadline, or you'll miss out on your captain's double points entirely.",
    });
  } else if (captain.health === "red") {
    cards.push({
      id: "captain-injured",
      tone: "red",
      title: "Set your captain before the deadline",
      body: `Your captain ${captain.name} is ${statusLabel(captain.status).toLowerCase()}. Change your captain before the deadline or you risk losing your armband's double points.`,
    });
  }

  if (!dashboard.squad.some((player) => player.isViceCaptain)) {
    cards.push({
      id: "vice-captain-missing",
      tone: "amber",
      title: "Set a vice-captain",
      body: "No vice-captain is set. Your vice-captain automatically gets the armband (and double points) if your captain doesn't play — without one, you could lose those points completely.",
    });
  }

  for (const player of dashboard.squad) {
    if (player.isCaptain || player.health !== "red") continue;
    cards.push({
      id: `flagged-${player.id}`,
      tone: "red",
      title: `${player.name} needs attention`,
      body: `${player.name} is ${statusLabel(player.status).toLowerCase()}${
        player.injuryReason ? ` (${player.injuryReason})` : ""
      }. Consider using a transfer to bring in a replacement before the deadline.`,
    });
  }

  for (const chip of dashboard.chips.filter((c) => c.available)) {
    const info = chipExplanationFor(chip.name);
    let body = info
      ? `${info.description} ${info.whenToUse}`
      : `Your ${chip.label} chip is available to play this gameweek.`;

    if (chip.name === "bboost") {
      const lastPlayedGameweek = dashboard.seasonHistory[dashboard.seasonHistory.length - 1];
      if (lastPlayedGameweek && lastPlayedGameweek.pointsOnBench > 0) {
        body += ` Your bench scored ${lastPlayedGameweek.pointsOnBench} points last week — Bench Boost would have added those to your total.`;
      }
    }

    cards.push({
      id: `chip-${chip.name}`,
      tone: "amber",
      title: `${chip.label} is available`,
      body,
      link: { href: "https://fantasy.premierleague.com", label: "Play it on the FPL site" },
    });
  }

  if (dashboard.nextDeadline) {
    const msRemaining = new Date(dashboard.nextDeadline).getTime() - Date.now();
    if (msRemaining > 0 && msRemaining <= 48 * 60 * 60 * 1000) {
      cards.push({
        id: "deadline-soon",
        tone: "red",
        title: "Deadline is close",
        body: `The gameweek ${dashboard.gameweek} deadline is in ${formatCountdown(
          msRemaining,
        )}. Make sure your transfers, captain and chips are locked in before then.`,
      });
    }
  }

  if (cards.length === 0) {
    cards.push({
      id: "all-good",
      tone: "green",
      title: `Your squad looks set for gameweek ${dashboard.gameweek}`,
      body: "No urgent issues found — check this week's AI recommendations below.",
    });
  }

  return cards;
}

const ACTION_CARD_TONE_CLASSES: Record<ActionAlert["tone"], string> = {
  red: "border-red-800/60 bg-red-950/25 text-red-100",
  amber: "border-amber-800/60 bg-amber-950/20 text-amber-100",
  green: "border-emerald-800/60 bg-emerald-950/20 text-emerald-100",
};

const ACTION_CARD_TITLE_CLASSES: Record<ActionAlert["tone"], string> = {
  red: "text-red-300",
  amber: "text-amber-300",
  green: "text-emerald-300",
};

function ActionCard({ alert }: { alert: ActionAlert }) {
  return (
    <div className={`rounded-lg border p-4 ${ACTION_CARD_TONE_CLASSES[alert.tone]}`}>
      <p className={`text-sm font-bold ${ACTION_CARD_TITLE_CLASSES[alert.tone]}`}>{alert.title}</p>
      <p className="mt-1.5 text-sm leading-relaxed">{alert.body}</p>
      {alert.link && (
        <a
          href={alert.link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs font-semibold underline decoration-current/40 underline-offset-2 hover:decoration-current"
        >
          {alert.link.label} &rarr;
        </a>
      )}
    </div>
  );
}

interface BriefingItem {
  id: string;
  kind: "price" | "injury" | "transfer";
  message: string;
}

const TRANSFER_OUT_WARNING_THRESHOLD = 100_000;

// Pure diff of the current squad against whatever status snapshot was
// stored on a previous visit (null on a brand-new team, in which case no
// injury is "new" yet — there's nothing to compare against). Price changes
// and transfer-out volume need no stored snapshot at all: FPL's bootstrap
// already tracks cost_change_event as the running total for this gameweek,
// and transfers_out_event is already a live gameweek-to-date count.
function computeBriefingItems(
  squad: SquadHealthPlayer[],
  previousStatuses: Record<number, string> | null,
): BriefingItem[] {
  const items: BriefingItem[] = [];

  for (const player of squad) {
    if (player.costChangeEvent === 0) continue;
    const direction = player.costChangeEvent > 0 ? "risen" : "fallen";
    const amount = (Math.abs(player.costChangeEvent) / 10).toFixed(1);
    items.push({
      id: `price-${player.id}`,
      kind: "price",
      message: `${player.name}'s price has ${direction} by £${amount}m.`,
    });
  }

  if (previousStatuses) {
    for (const player of squad) {
      const previousStatus = previousStatuses[player.id];
      const wasFlagged = previousStatus != null && previousStatus !== "a";
      const isFlagged = player.status !== "a";
      if (isFlagged && !wasFlagged) {
        items.push({
          id: `injury-${player.id}`,
          kind: "injury",
          message: `${player.name} has been newly flagged as ${statusLabel(player.status).toLowerCase()}.`,
        });
      }
    }
  }

  for (const player of squad) {
    if (player.transfersOutEvent > TRANSFER_OUT_WARNING_THRESHOLD) {
      items.push({
        id: `transfer-${player.id}`,
        kind: "transfer",
        message: `${player.transfersOutEvent.toLocaleString()} managers have transferred out ${player.name} this gameweek.`,
      });
    }
  }

  return items;
}

function summarizeBriefing(items: BriefingItem[]): string {
  const priceCount = items.filter((item) => item.kind === "price").length;
  const injuryCount = items.filter((item) => item.kind === "injury").length;
  const transferCount = items.filter((item) => item.kind === "transfer").length;

  const parts: string[] = [];
  if (priceCount > 0) parts.push(`${priceCount} price change${priceCount === 1 ? "" : "s"}`);
  if (injuryCount > 0) parts.push(`${injuryCount} injury update${injuryCount === 1 ? "" : "s"}`);
  if (transferCount > 0) parts.push(`${transferCount} transfer warning${transferCount === 1 ? "" : "s"}`);

  if (parts.length === 0) return "no major changes";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const BRIEFING_ITEM_CLASSES: Record<BriefingItem["kind"], string> = {
  price: "border-sky-800/60 bg-sky-950/20 text-sky-100",
  injury: "border-red-800/60 bg-red-950/20 text-red-100",
  transfer: "border-amber-800/60 bg-amber-950/20 text-amber-100",
};

function BriefingList({ items }: { items: BriefingItem[] }) {
  if (items.length === 0) {
    return <p className="mt-3 text-sm text-muted">No changes since your last visit.</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className={`rounded-lg border px-3 py-2 text-sm ${BRIEFING_ITEM_CLASSES[item.kind]}`}>
          {item.message}
        </li>
      ))}
    </ul>
  );
}

// Loads the previous snapshot, diffs it against the freshly-fetched squad,
// then immediately overwrites the snapshot with the current state — so the
// stored baseline always reflects "as of the last time this ran", whether
// that was yesterday or a refresh two minutes ago. The daily banner is a
// separate, coarser signal (calendar day, not per-fetch) layered on top:
// it only fires the first time in a new calendar day, and only when there's
// a previously recorded visit to compare against (a brand-new team has
// nothing to say "changed since yesterday" yet).
function useDailyBriefing(teamId: string, dashboard: DashboardData | null) {
  const [items, setItems] = useState<BriefingItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [showDailyBanner, setShowDailyBanner] = useState(false);

  useEffect(() => {
    if (!dashboard || !dashboard.seasonStarted || dashboard.squad.length === 0) return;

    Promise.resolve().then(() => {
      const previous = loadBriefingSnapshot(teamId);
      const nextItems = computeBriefingItems(dashboard.squad, previous?.statuses ?? null);
      setItems(nextItems);
      setLastUpdated(new Date().toISOString());

      saveBriefingSnapshot(teamId, {
        statuses: Object.fromEntries(dashboard.squad.map((player) => [player.id, player.status])),
      });

      const today = new Date().toISOString().slice(0, 10);
      const lastVisitDate = loadLastVisitDate(teamId);
      if (lastVisitDate && lastVisitDate !== today && nextItems.length > 0) {
        setShowDailyBanner(true);
      }
      saveLastVisitDate(teamId, today);
    });
  }, [dashboard, teamId]);

  return { items, lastUpdated, showDailyBanner, dismissBanner: () => setShowDailyBanner(false) };
}

function ChipsInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-card-border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-foreground">Chips explained</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-lg leading-none text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            &times;
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-4">
          {CHIP_EXPLANATIONS.map((chip) => (
            <div key={chip.name} className="border-t border-card-border/50 pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm font-bold text-accent">{chip.label}</p>
              <p className="mt-1 text-sm text-foreground/90">{chip.description}</p>
              <p className="mt-1.5 text-xs text-muted">{chip.whenToUse}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LeagueCard({ league }: { league: DashboardLeague }) {
  // Read directly at render time — a plain localStorage lookup, not state —
  // so the unread count always reflects whatever's currently stored.
  const unread = countUnread(league.id);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-card-border/70 bg-background/40 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{league.name}</p>
        {unread > 0 && (
          <span className="mt-0.5 inline-block rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
            {unread} new
          </span>
        )}
      </div>
      <Link
        href={`/league/${league.id}`}
        className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
      >
        View league
      </Link>
    </div>
  );
}

function WhatsHappeningGrid({ tiles }: { tiles: WhatsHappeningTile[] }) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-lg border border-card-border/70 bg-background/40 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{tile.label}</p>
          <p className="mt-1 text-lg font-bold text-foreground">{tile.value}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{tile.context}</p>
        </div>
      ))}
    </div>
  );
}

function CountdownTimer({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  if (!deadline) return <span>—</span>;
  const remaining = new Date(deadline).getTime() - now;
  return <span>{formatCountdown(remaining)}</span>;
}

function SquadHealthCard({ player }: { player: SquadHealthPlayer }) {
  return (
    <div className={`rounded-lg border p-3 ${healthCardClasses(player.health)}`}>
      <div className="flex items-center justify-between gap-1">
        <span className={`h-2 w-2 shrink-0 rounded-full ${healthDotClasses(player.health)}`} />
        <div className="flex items-center gap-1">
          {player.isCaptain && <span className="text-[10px] font-bold text-accent">C</span>}
          {player.isViceCaptain && <span className="text-[10px] font-bold text-muted">V</span>}
        </div>
      </div>
      <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
        {player.position} &middot; {player.club}
      </p>
      <p className="truncate font-semibold text-foreground">{player.name}</p>
      <p className="text-[10px] text-muted">{statusLabel(player.status)}</p>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-muted">
          Form {player.form} <span className={trendColorClass(player.trend)}>{trendGlyph(player.trend)}</span>
        </span>
        {player.restDays != null && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${restBadgeClasses(player.restDays)}`}
          >
            {player.restDays}d rest
          </span>
        )}
      </div>
    </div>
  );
}

// Single-series bar chart (points per gameweek) with a muted average-score
// line overlaid on the same points axis, native <title> tooltips per bar/dot
// for hover detail, and a direct label on only the latest gameweek.
function GameweekChart({ rows }: { rows: SeasonHistoryRow[] }) {
  const width = 640;
  const height = 220;
  const padding = { top: 24, right: 16, bottom: 28, left: 16 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxPoints = Math.max(...rows.map((r) => r.points), ...rows.map((r) => r.average ?? 0), 20);
  const barSlot = plotWidth / rows.length;
  const barWidth = Math.min(36, barSlot * 0.55);

  const xFor = (index: number) => padding.left + index * barSlot + barSlot / 2;
  const yFor = (points: number) => padding.top + plotHeight * (1 - points / maxPoints);

  const averagePoints = rows
    .map((row, index) => (row.average != null ? `${xFor(index)},${yFor(row.average)}` : null))
    .filter((point): point is string => point !== null)
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[420px]" role="img" aria-label="Points per gameweek">
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <line
            key={fraction}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight * (1 - fraction)}
            y2={padding.top + plotHeight * (1 - fraction)}
            stroke="var(--card-border)"
            strokeWidth={1}
          />
        ))}

        {rows.map((row, index) => {
          const barHeight = plotHeight * (row.points / maxPoints);
          const isLatest = index === rows.length - 1;
          return (
            <g key={row.event}>
              <rect
                x={xFor(index) - barWidth / 2}
                y={yFor(row.points)}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={4}
                fill="var(--accent-strong)"
              >
                <title>
                  GW{row.event}: {row.points} pts{row.average != null ? ` (league average ${row.average})` : ""}
                </title>
              </rect>
              {isLatest && (
                <text
                  x={xFor(index)}
                  y={yFor(row.points) - 8}
                  textAnchor="middle"
                  className="fill-foreground text-[11px] font-semibold"
                >
                  {row.points}
                </text>
              )}
              <text
                x={xFor(index)}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {row.event}
              </text>
            </g>
          );
        })}

        {averagePoints && (
          <polyline
            points={averagePoints}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}
        {rows.map(
          (row, index) =>
            row.average != null && (
              <circle key={`avg-${row.event}`} cx={xFor(index)} cy={yFor(row.average)} r={3} fill="var(--muted)">
                <title>
                  GW{row.event} league average: {row.average} pts
                </title>
              </circle>
            ),
        )}
      </svg>

      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-accent-strong" /> Your points
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-muted" /> League average
        </span>
      </div>
    </div>
  );
}

// ---- shared fetch helpers ----------------------------------------------------
// Factored out so both the initial-load effects and the manual Refresh
// button call the exact same request shape.

async function fetchDashboardData(teamId: string): Promise<DashboardResponse> {
  const res = await fetch(`/api/dashboard?teamId=${teamId}`);
  const data = (await res.json()) as DashboardResponse;
  if (!res.ok) throw new Error(data.error ?? "Failed to load dashboard.");
  return data;
}

async function fetchAdviceData(dashboard: DashboardData): Promise<AdviceResponse> {
  const res = await fetch("/api/advice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      teamName: dashboard.teamName,
      gameweek: dashboard.gameweek,
      bank: dashboard.bank,
      squadValue: dashboard.squadValue,
      squad: dashboard.squad,
      availableChips: dashboard.chips.filter((chip) => chip.available),
    }),
  });
  const data = (await res.json()) as AdviceResponse;
  if (!res.ok) throw new Error(data.error ?? "Failed to generate advice.");
  return data;
}

// ---- accuracy tracker hook --------------------------------------------------

function loadLog(teamId: string): AccuracyLogEntry[] {
  try {
    const raw = localStorage.getItem(`fpl-advisor:accuracy-log:${teamId}`);
    if (raw) return JSON.parse(raw) as AccuracyLogEntry[];
  } catch {
    // fall through to default
  }
  if (teamId === DEMO_TEAM_ID) {
    return [
      {
        gameweek: 2,
        recommendedCaptain: "Haaland",
        actualCaptain: "Haaland",
        points: 51,
        followed: true,
        status: "resolved",
        recordedAt: new Date().toISOString(),
      },
    ];
  }
  return [];
}

function saveLog(teamId: string, log: AccuracyLogEntry[]) {
  try {
    localStorage.setItem(`fpl-advisor:accuracy-log:${teamId}`, JSON.stringify(log));
  } catch {
    // localStorage unavailable (private browsing, quota) — tracker just won't persist
  }
}

function useAccuracyTracker(
  teamId: string,
  dashboard: DashboardResponse | null,
  advice: AdviceResponse | null,
): AccuracyLogEntry[] {
  // Loaded once per mount (the parent remounts this whole tree on teamId
  // change via `key`), so a lazy initializer covers it without an effect.
  const [log, setLog] = useState<AccuracyLogEntry[]>(() => loadLog(teamId));

  // Record a pending prediction for the current gameweek once advice loads.
  // The setState is deferred into a microtask (matching the shape of the
  // fetch().then(...) pattern used elsewhere in this app) rather than called
  // synchronously at the top of the effect body.
  useEffect(() => {
    if (!dashboard || !dashboard.seasonStarted || !advice || teamId === DEMO_TEAM_ID) return;

    Promise.resolve().then(() => {
      setLog((prev) => {
        if (prev.some((entry) => entry.gameweek === dashboard.gameweek)) return prev;
        const next: AccuracyLogEntry[] = [
          ...prev,
          {
            gameweek: dashboard.gameweek,
            recommendedCaptain: extractRecommendedCaptain(advice.captain, dashboard.squad),
            actualCaptain: null,
            points: null,
            followed: null,
            status: "pending",
            recordedAt: new Date().toISOString(),
          },
        ];
        saveLog(teamId, next);
        return next;
      });
    });
  }, [dashboard, advice, teamId]);

  // Resolve any pending entries whose gameweek now has a played result.
  useEffect(() => {
    if (!dashboard) return;
    const readyToResolve = log.filter(
      (entry) =>
        entry.status === "pending" &&
        dashboard.seasonHistory.some((row) => row.event === entry.gameweek),
    );
    if (readyToResolve.length === 0) return;

    let cancelled = false;
    (async () => {
      const resolutions = await Promise.all(
        readyToResolve.map(async (entry) => {
          const gwRow = dashboard.seasonHistory.find((row) => row.event === entry.gameweek);
          try {
            const res = await fetch(`/api/gameweek-captain?teamId=${teamId}&gameweek=${entry.gameweek}`);
            const data = (await res.json()) as { captainName: string | null };
            const followed =
              entry.recommendedCaptain && data.captainName
                ? entry.recommendedCaptain.toLowerCase() === data.captainName.toLowerCase()
                : null;
            return {
              ...entry,
              actualCaptain: data.captainName,
              points: gwRow?.points ?? null,
              followed,
              status: "resolved" as const,
            };
          } catch {
            return entry;
          }
        }),
      );

      if (cancelled) return;
      setLog((prev) => {
        const next = prev.map((entry) => resolutions.find((r) => r.gameweek === entry.gameweek) ?? entry);
        saveLog(teamId, next);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboard, log, teamId]);

  return log;
}

// ---- page --------------------------------------------------------------------

export default function DashboardPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  // Keyed on teamId so navigating to a different team remounts cleanly.
  return <DashboardContent key={teamId} teamId={teamId} />;
}

function DashboardContent({ teamId }: { teamId: string }) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [adviceError, setAdviceError] = useState("");
  const [showChipsInfo, setShowChipsInfo] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [showFullAdvice, setShowFullAdvice] = useState(false);
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());
  // Derived rather than a separate setState-in-effect: true exactly while
  // the auto-fetch effect below (or a manual refresh) has fired but neither
  // advice nor an error has landed yet.
  const loadingAdvice = Boolean(dashboard?.seasonStarted) && (dashboard?.squad.length ?? 0) > 0 && !advice && !adviceError;

  useEffect(() => {
    let cancelled = false;

    fetchDashboardData(teamId)
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setDashboardError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDashboard(false);
      });

    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Auto-fetch AI advice once the squad is known — the priorities panel and
  // accuracy tracker both need the captain recommendation up front.
  useEffect(() => {
    if (!dashboard || !dashboard.seasonStarted || dashboard.squad.length === 0) return;
    let cancelled = false;

    fetchAdviceData(dashboard)
      .then((data) => {
        if (!cancelled) setAdvice(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setAdviceError(err.message);
      });

    return () => {
      cancelled = true;
    };
    // dashboard is a fresh object each fetch; keying on the fields that
    // actually change what advice should say avoids re-firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.teamId, dashboard?.gameweek, dashboard?.seasonStarted]);

  const accuracyLog = useAccuracyTracker(teamId, dashboard, advice);
  const { items: briefingItems, lastUpdated, showDailyBanner, dismissBanner } = useDailyBriefing(teamId, dashboard);

  // Re-fetches live dashboard data and re-runs AI advice on demand, without
  // a full page reload. Doesn't touch loadingDashboard (the dashboard stays
  // on screen throughout) — refreshing/refreshError drive a small inline
  // status next to the Refresh button instead.
  // Reveals the advice cards using whatever the background auto-fetch has
  // already produced (the common case, since that fetch starts on mount) —
  // only issuing a fresh request itself if the background fetch already
  // failed, so a click can also serve as a retry.
  function handleShowAdvice() {
    setShowFullAdvice(true);
    if (adviceError && dashboard) {
      setAdviceError("");
      fetchAdviceData(dashboard)
        .then(setAdvice)
        .catch((err: Error) => setAdviceError(err.message));
    }
  }

  function toggleAction(index: number) {
    setCheckedActions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError("");
    setAdvice(null);
    setAdviceError("");
    setCheckedActions(new Set());

    try {
      const freshDashboard = await fetchDashboardData(teamId);
      setDashboard(freshDashboard);

      if (freshDashboard.seasonStarted && freshDashboard.squad.length > 0) {
        try {
          const freshAdvice = await fetchAdviceData(freshDashboard);
          setAdvice(freshAdvice);
        } catch (err) {
          setAdviceError(err instanceof Error ? err.message : "Failed to generate advice.");
        }
      }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Failed to refresh dashboard.");
    } finally {
      setRefreshing(false);
    }
  }

  const flaggedPlayers = dashboard
    ? dashboard.squad.filter(
        (player) => player.health === "red" || player.trend === "declining",
      )
    : [];

  const availableChips = dashboard ? dashboard.chips.filter((chip) => chip.available) : [];

  const actionCards =
    dashboard && dashboard.seasonStarted && dashboard.squad.length > 0 ? buildActionCards(dashboard) : [];

  const startingPlayers = dashboard ? dashboard.squad.filter((player) => player.isStarting) : [];
  const benchPlayers = dashboard ? dashboard.squad.filter((player) => !player.isStarting) : [];
  const flaggedBenchPlayers = benchPlayers.filter(looksLikeAStarter);

  const rankTopPercent = dashboard ? rankPercentile(dashboard.overallRank, dashboard.totalPlayers) : null;

  const history = dashboard?.seasonHistory ?? [];
  const bestGw = history.length > 0 ? history.reduce((a, b) => (b.points > a.points ? b : a)) : null;
  const worstGw = history.length > 0 ? history.reduce((a, b) => (b.points < a.points ? b : a)) : null;
  const rankDelta =
    history.length >= 2 ? history[history.length - 1].overallRank - history[history.length - 2].overallRank : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
          &larr; Back
        </Link>
        <div className="flex items-center gap-5">
          <Link href={`/team/${teamId}`} className="text-sm text-muted transition-colors hover:text-accent">
            Squad view
          </Link>
          <Link href="/players" className="text-sm text-muted transition-colors hover:text-accent">
            All players
          </Link>
          <Link href="/build" className="text-sm text-muted transition-colors hover:text-accent">
            Build squad
          </Link>
          <Link href="/league/demo" className="text-sm text-muted transition-colors hover:text-accent">
            League
          </Link>
          <Link href="/guide" className="text-sm text-muted transition-colors hover:text-accent">
            Guide
          </Link>
          <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
            Trends analysis &rarr;
          </Link>
        </div>
      </div>

      {loadingDashboard && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
          <p>Loading dashboard...</p>
        </div>
      )}

      {!loadingDashboard && dashboardError && (
        <div className="mt-16 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
          {dashboardError}
        </div>
      )}

      {!loadingDashboard && dashboard && (
        <>
          {/* 1. Header */}
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <header className="flex flex-col gap-1">
              {dashboard.isDemo && (
                <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  Demo squad
                </span>
              )}
              <h1 className="text-3xl font-bold text-foreground">{dashboard.teamName}</h1>
              <p className="text-muted">
                {dashboard.managerName}
                {dashboard.seasonStarted ? ` · Gameweek ${dashboard.gameweek}` : ""}
              </p>
            </header>

            {dashboard.seasonStarted && (
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
                {lastUpdated && !refreshError && (
                  <p className="text-[11px] text-muted">Last updated {formatUpdatedTime(lastUpdated)}</p>
                )}
                {refreshError && <p className="text-[11px] text-red-400">{refreshError}</p>}
              </div>
            )}
          </div>

          {showDailyBanner && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground">
              <p>
                <span className="font-semibold text-accent">Your daily briefing is ready</span> — here&apos;s
                what&apos;s changed since yesterday: {summarizeBriefing(briefingItems)}.
              </p>
              <button
                type="button"
                onClick={dismissBanner}
                aria-label="Dismiss"
                className="shrink-0 rounded-full p-1 text-lg leading-none text-muted transition-colors hover:bg-white/10 hover:text-foreground"
              >
                &times;
              </button>
            </div>
          )}

          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Overall rank"
              value={formatRankWithTotal(dashboard.overallRank, dashboard.totalPlayers)}
              sub={rankTopPercent != null ? `Top ${rankTopPercent}%` : undefined}
            />
            <StatTile label="Total points" value={dashboard.overallPoints} />
            <StatTile
              label="Last gameweek"
              value={dashboard.lastGameweekPoints ?? "—"}
              sub={
                dashboard.lastGameweekPoints != null && dashboard.lastGameweekAverage != null
                  ? `Average: ${dashboard.lastGameweekAverage}`
                  : undefined
              }
            />
            <StatTile label="Next deadline" value={<CountdownTimer deadline={dashboard.nextDeadline} />} />
          </section>

          {actionCards.length > 0 && (
            <section className="mt-5">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Actions needed</h2>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {actionCards.map((alert) => (
                  <ActionCard key={alert.id} alert={alert} />
                ))}
              </div>
            </section>
          )}

          {dashboard.seasonStarted && dashboard.squad.length > 0 && (
            <section className="mt-5 rounded-xl border border-card-border bg-card p-5">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
                Recent changes &amp; upcoming
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Transfer history
                  </h3>
                  {dashboard.transferHistory.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No transfers made yet this season.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {dashboard.transferHistory.map((transfer, index) => (
                        <li key={index} className="text-sm">
                          <span className="text-foreground">
                            Sold {transfer.soldName}, Bought {transfer.boughtName}
                          </span>
                          <span className="text-muted"> — Gameweek {transfer.event}</span>{" "}
                          <span className={transfer.costPoints < 0 ? "text-red-400" : "text-emerald-400"}>
                            {transfer.costPoints < 0 ? `(${transfer.costPoints}pts)` : "(Free)"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Before the next deadline
                  </h3>
                  <ul className="mt-2 flex flex-col gap-2 text-sm">
                    <li>
                      <span className="text-muted">Captain: </span>
                      {dashboard.upcoming.captainName ? (
                        <span className="text-foreground">{dashboard.upcoming.captainName}</span>
                      ) : (
                        <span className="text-red-400">Not set</span>
                      )}
                    </li>
                    <li>
                      <span className="text-muted">Vice-captain: </span>
                      {dashboard.upcoming.viceCaptainName ? (
                        <span className="text-foreground">{dashboard.upcoming.viceCaptainName}</span>
                      ) : (
                        <span className="text-red-400">Not set</span>
                      )}
                    </li>
                    <li>
                      <span className="text-muted">Transfers this gameweek: </span>
                      <span className="text-foreground">
                        {dashboard.upcoming.transfersThisGameweek}
                        {dashboard.upcoming.transfersCostThisGameweek < 0
                          ? ` (${dashboard.upcoming.transfersCostThisGameweek}pts)`
                          : ""}
                      </span>
                    </li>
                    <li>
                      <span className="text-muted">Free transfers next week: </span>
                      <span className="text-foreground">{dashboard.upcoming.freeTransfersNextWeek ?? "—"}</span>
                    </li>
                    <li>
                      <span className="text-muted">Chips activated this gameweek: </span>
                      <span className="text-foreground">
                        {dashboard.upcoming.chipsActivatedThisGameweek.length > 0
                          ? dashboard.upcoming.chipsActivatedThisGameweek.join(", ")
                          : "None"}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          )}

          {dashboard.seasonStarted && dashboard.squad.length > 0 && (
            <section className="mt-5 rounded-xl border border-card-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Today&apos;s briefing</h2>
                {lastUpdated && (
                  <span className="text-[10px] text-muted">Updated {formatUpdatedTime(lastUpdated)}</span>
                )}
              </div>
              <BriefingList items={briefingItems} />
            </section>
          )}

          {dashboard.whatsHappening.length > 0 && (
            <section className="mt-5 rounded-xl border border-card-border bg-card p-5">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">What&apos;s happening in FPL</h2>
              <WhatsHappeningGrid tiles={dashboard.whatsHappening} />
            </section>
          )}

          {dashboard.leagues.length > 0 && (
            <section className="mt-5">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Your leagues</h2>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dashboard.leagues.map((league) => (
                  <LeagueCard key={league.id} league={league} />
                ))}
              </div>
            </section>
          )}

          {!dashboard.seasonStarted && (
            <div className="mt-10 rounded-xl border border-card-border bg-card p-6 text-center">
              <p className="text-foreground">
                The full dashboard fills in once the season starts on 21 August. In the meantime,
                use the{" "}
                <Link
                  href="/build"
                  className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
                >
                  Build
                </Link>{" "}
                page to plan your squad.
              </p>
            </div>
          )}

          {dashboard.seasonStarted && (
            <>
              {/* 2. This week's priorities */}
              <section className="mt-8 rounded-xl border border-card-border bg-card p-5">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
                  This week&apos;s priorities
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Captain</p>
                    {loadingAdvice && <p className="mt-1 text-sm text-muted">Thinking it through...</p>}
                    {!loadingAdvice && adviceError && <p className="mt-1 text-sm text-red-300">{adviceError}</p>}
                    {!loadingAdvice && advice && (
                      <p className="mt-1 text-sm text-foreground">{condenseToOneLine(advice.captain)}</p>
                    )}
                    <p className="mt-1.5 text-[10px] text-muted">
                      This is a recommendation, not a setting — your actual captain is whoever you&apos;ve
                      picked on{" "}
                      <a
                        href="https://fantasy.premierleague.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted underline decoration-muted/40 underline-offset-2 hover:text-accent hover:decoration-accent"
                      >
                        fantasy.premierleague.com
                      </a>{" "}
                      — this app just reads it automatically, it can&apos;t change it for you.
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Deadline</p>
                    <p className="mt-1 text-sm text-foreground">
                      <CountdownTimer deadline={dashboard.nextDeadline} />
                      {dashboard.nextDeadline && (
                        <span className="ml-2 text-xs text-muted">{formatDeadlineDate(dashboard.nextDeadline)}</span>
                      )}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Flagged players</p>
                    {flaggedPlayers.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">No injuries or declining players right now.</p>
                    ) : (
                      <p className="mt-1 text-sm text-red-400">
                        {flaggedPlayers
                          .map(
                            (player) =>
                              `${player.name} (${player.health === "red" ? statusLabel(player.status) : "declining"})`,
                          )
                          .join(", ")}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Chips available
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowChipsInfo(true)}
                        aria-label="What do the chips do?"
                        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-muted/60 text-[9px] font-bold leading-none text-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        i
                      </button>
                    </div>
                    {availableChips.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">None left in this window.</p>
                    ) : (
                      <p className="mt-1 text-sm text-accent">
                        {availableChips.map((chip) => chip.label).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {!showFullAdvice && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={handleShowAdvice}
                    disabled={loadingAdvice}
                    className="rounded-lg bg-accent-strong px-8 py-3 font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loadingAdvice ? "Thinking it through..." : "Get AI Advice"}
                  </button>
                </div>
              )}

              {showFullAdvice && (
                <>
                  {loadingAdvice && (
                    <div className="mt-6 flex flex-col items-center gap-3 text-muted">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
                      <p>Thinking it through...</p>
                    </div>
                  )}

                  {!loadingAdvice && adviceError && (
                    <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-center text-red-300">
                      {adviceError}
                    </div>
                  )}

                  {!loadingAdvice && advice && (
                    <>
                      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                        <AdviceCard title="Transfer" body={advice.transfer} tone="green" />
                        <AdviceCard title="Captain" body={advice.captain} tone="red" />
                        <AdviceCard title="Chip" body={advice.chip} tone="blue" />
                      </section>
                      <ActionChecklist
                        actions={advice.actions}
                        advice={advice}
                        squadNames={dashboard.squad.map((player) => player.name)}
                        checkedActions={checkedActions}
                        onToggle={toggleAction}
                      />
                    </>
                  )}
                </>
              )}

              {/* 3. Squad health grid */}
              <section className="mt-8">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Squad health</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {dashboard.squad.map((player) => (
                    <SquadHealthCard key={player.id} player={player} />
                  ))}
                </div>
              </section>

              {/* 3b. Starting XI vs Bench */}
              <section className="mt-8 rounded-xl border border-card-border bg-card p-5">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Starting XI vs Bench</h2>
                <p className="mt-3 text-sm text-muted">
                  Only your starting XI&apos;s points count towards your total by default — a bench player only
                  scores if a starter in the same position doesn&apos;t play, via FPL&apos;s automatic
                  substitutions. Think of the bench as a safety net, not a source of extra points.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Starting XI
                    </h3>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {startingPlayers.map((player) => (
                        <li key={player.id} className="flex items-center justify-between text-sm">
                          <span className="text-foreground">
                            {player.name} <span className="text-muted">({player.position})</span>
                          </span>
                          <span className="text-xs text-muted">{player.totalPoints} pts</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Bench</h3>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {benchPlayers.map((player) => (
                        <li key={player.id} className="flex items-center justify-between text-sm">
                          <span className={looksLikeAStarter(player) ? "font-semibold text-amber-400" : "text-foreground"}>
                            {player.name} <span className="text-muted">({player.position})</span>
                          </span>
                          <span className="text-xs text-muted">{player.totalPoints} pts</span>
                        </li>
                      ))}
                    </ul>
                    {flaggedBenchPlayers.length > 0 && (
                      <p className="mt-2 text-xs text-amber-400">
                        {flaggedBenchPlayers.map((player) => player.name).join(", ")}{" "}
                        {flaggedBenchPlayers.length === 1 ? "looks" : "look"} good enough to start —
                        worth reviewing your lineup before the deadline.
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* 4. Season story */}
              <section className="mt-8 rounded-xl border border-card-border bg-card p-5">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Season story</h2>
                {history.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    No gameweeks played yet — the trajectory chart fills in after gameweek 1.
                  </p>
                ) : (
                  <>
                    <div className="mt-4">
                      <GameweekChart rows={history} />
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <StatTile
                        label="Best gameweek"
                        value={bestGw ? `${bestGw.points} pts` : "—"}
                        sub={bestGw ? `Gameweek ${bestGw.event}` : undefined}
                      />
                      <StatTile
                        label="Worst gameweek"
                        value={worstGw ? `${worstGw.points} pts` : "—"}
                        sub={worstGw ? `Gameweek ${worstGw.event}` : undefined}
                      />
                      <StatTile
                        label="Rank trend"
                        value={
                          rankDelta == null
                            ? "—"
                            : rankDelta < 0
                              ? `Up ${Math.abs(rankDelta).toLocaleString()}`
                              : rankDelta > 0
                                ? `Down ${rankDelta.toLocaleString()}`
                                : "No change"
                        }
                        sub="vs previous gameweek"
                      />
                    </div>
                  </>
                )}
              </section>

              {/* 5. AI accuracy tracker */}
              <section className="mt-8 rounded-xl border border-card-border bg-card p-5">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">AI accuracy tracker</h2>
                {accuracyLog.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">
                    Starts tracking from this gameweek onward — check back after the deadline passes and
                    results come in.
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-muted">
                          <th className="pb-1 pr-3 text-left font-semibold">GW</th>
                          <th className="pb-1 pr-3 text-left font-semibold">AI recommended</th>
                          <th className="pb-1 pr-3 text-left font-semibold">You captained</th>
                          <th className="pb-1 pr-3 text-right font-semibold">Points</th>
                          <th className="pb-1 text-right font-semibold">Followed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...accuracyLog]
                          .sort((a, b) => b.gameweek - a.gameweek)
                          .map((entry) => (
                            <tr key={entry.gameweek} className="border-t border-card-border/50">
                              <td className="py-1.5 pr-3 text-foreground">{entry.gameweek}</td>
                              <td className="py-1.5 pr-3 text-foreground">
                                {entry.recommendedCaptain ?? "—"}
                              </td>
                              <td className="py-1.5 pr-3 text-foreground">
                                {entry.status === "pending" ? (
                                  <span className="text-muted">Pending...</span>
                                ) : (
                                  (entry.actualCaptain ?? "—")
                                )}
                              </td>
                              <td className="py-1.5 pr-3 text-right text-foreground">
                                {entry.points ?? "—"}
                              </td>
                              <td className="py-1.5 text-right">
                                {entry.status === "pending" ? (
                                  <span className="text-muted">—</span>
                                ) : entry.followed == null ? (
                                  <span className="text-muted">—</span>
                                ) : entry.followed ? (
                                  <span className="text-accent">Yes</span>
                                ) : (
                                  <span className="text-red-400">No</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}

      {showChipsInfo && <ChipsInfoModal onClose={() => setShowChipsInfo(false)} />}
    </div>
  );
}
