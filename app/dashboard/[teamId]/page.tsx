"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { DEMO_TEAM_ID } from "@/lib/fpl";
import type { DashboardData, SeasonHistoryRow, SquadHealthPlayer } from "@/lib/dashboard-types";

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
  // Derived rather than a separate setState-in-effect: true exactly while
  // the auto-fetch effect below has fired but neither advice nor an error
  // has landed yet.
  const loadingAdvice = Boolean(dashboard?.seasonStarted) && (dashboard?.squad.length ?? 0) > 0 && !advice && !adviceError;

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/dashboard?teamId=${teamId}`)
      .then(async (res) => {
        const data = (await res.json()) as DashboardResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load dashboard.");
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

    fetch("/api/advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamName: dashboard.teamName,
        gameweek: dashboard.gameweek,
        bank: dashboard.bank,
        squadValue: dashboard.squadValue,
        squad: dashboard.squad,
      }),
    })
      .then(async (res) => {
        const data = (await res.json()) as AdviceResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to generate advice.");
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

  const flaggedPlayers = dashboard
    ? dashboard.squad.filter(
        (player) => player.health === "red" || player.trend === "declining",
      )
    : [];

  const availableChips = dashboard ? dashboard.chips.filter((chip) => chip.available) : [];

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
          <header className="mt-4 flex flex-col gap-1">
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

          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Overall rank" value={dashboard.overallRank > 0 ? dashboard.overallRank.toLocaleString() : "—"} />
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
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Chips available</p>
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

              {/* 3. Squad health grid */}
              <section className="mt-8">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Squad health</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {dashboard.squad.map((player) => (
                    <SquadHealthCard key={player.id} player={player} />
                  ))}
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
    </div>
  );
}
