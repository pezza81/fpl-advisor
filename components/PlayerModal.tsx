"use client";

import { Fragment, useEffect, useState } from "react";
import type { SquadPlayer } from "@/lib/fpl";
import {
  estimatePointsBreakdown,
  type FplMinutesTrend,
  type FplPlayerTrend,
  type FplSeasonRow,
} from "@/lib/fpl-history";
import type { LineupStatus, PlayerMatchContext } from "@/lib/api-football";

// Shared between the squad page and the /players browser — both open the
// same modal for a clicked player, backed by the same /api/player-insight
// response shape.
export interface PlayerInsight {
  trend: FplPlayerTrend;
  minutesTrend: FplMinutesTrend;
  fplSeasons: FplSeasonRow[];
  summary: string;
  matchContext?: PlayerMatchContext;
  error?: string;
}

function trendBadgeClasses(direction: FplPlayerTrend["direction"]): string {
  switch (direction) {
    case "rising":
      return "bg-emerald-800/70 text-emerald-100";
    case "declining":
      return "bg-red-800/70 text-red-100";
    case "stable":
      return "bg-sky-800/70 text-sky-100";
    default:
      return "bg-card-border text-muted";
  }
}

function trendLabel(trend: FplPlayerTrend): string {
  if (trend.direction === "rising") return "Rising ↑";
  if (trend.direction === "declining") return "Declining ↓";
  if (trend.direction === "stable") return "Stable";
  return "No historical data";
}

function trendSeasonsText(trend: FplPlayerTrend): string | null {
  if (trend.previousSeason == null || trend.latestSeason == null) return null;
  return `${trend.previousSeason}: ${trend.previousOutput} G+A → ${trend.latestSeason}: ${trend.latestOutput} G+A`;
}

function minutesBadgeClasses(direction: FplMinutesTrend["direction"]): string {
  switch (direction) {
    case "increasing":
      return "bg-emerald-800/70 text-emerald-100";
    case "decreasing":
      return "bg-red-800/70 text-red-100";
    case "stable":
      return "bg-sky-800/70 text-sky-100";
    default:
      return "bg-card-border text-muted";
  }
}

function minutesTrendLabel(trend: FplMinutesTrend): string {
  if (trend.direction === "increasing") return "Increasing ↑";
  if (trend.direction === "decreasing") return "Decreasing ↓";
  if (trend.direction === "stable") return "Stable";
  return "Unknown";
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function lineupBadgeClasses(status: LineupStatus["status"]): string {
  switch (status) {
    case "starting":
      return "bg-emerald-800/70 text-emerald-100";
    case "bench":
      return "bg-amber-800/70 text-amber-100";
    default:
      return "bg-card-border text-muted";
  }
}

function lineupLabel(status: LineupStatus["status"]): string {
  if (status === "starting") return "Expected to start";
  if (status === "bench") return "Expected on bench";
  return "Unknown";
}

// Mirrors the 3 / 4-5 / 6+ day buckets in lib/team-stats.ts (restBucketFor)
// — kept as a small local duplicate rather than importing that server-only,
// SQLite-backed module into a client component.
function restDaysBadgeClasses(days: number): string {
  if (days <= 3) return "bg-red-800/70 text-red-100";
  if (days <= 5) return "bg-amber-800/70 text-amber-100";
  return "bg-emerald-800/70 text-emerald-100";
}

// Small up/down/flat indicator comparing one season's stat to the prior row.
// `invert` flips the color semantics for stats where lower is better (goals
// conceded) — the arrow direction itself always reflects the raw number.
function TrendArrow({
  current,
  previous,
  invert = false,
}: {
  current: number;
  previous: number;
  invert?: boolean;
}) {
  if (current === previous) return <span className="ml-1 text-muted">→</span>;
  const wentUp = current > previous;
  const isGood = invert ? !wentUp : wentUp;
  const colorClass = isGood ? "text-emerald-400" : "text-red-400";
  return <span className={`ml-1 ${colorClass}`}>{wentUp ? "↑" : "↓"}</span>;
}

type PositionCode = "GKP" | "DEF" | "MID" | "FWD";

type NumericSeasonKey = Exclude<keyof FplSeasonRow, "seasonLabel">;

interface SeasonStatColumn {
  key: NumericSeasonKey | "shots";
  label: string;
  invert?: boolean;
}

const POSITION_SEASON_COLUMNS: Record<PositionCode, SeasonStatColumn[]> = {
  GKP: [
    { key: "cleanSheets", label: "Clean sheets" },
    { key: "saves", label: "Saves" },
    { key: "goalsConceded", label: "Conceded", invert: true },
    { key: "bonus", label: "Bonus" },
  ],
  DEF: [
    { key: "cleanSheets", label: "Clean sheets" },
    { key: "goals", label: "Goals" },
    { key: "assists", label: "Assists" },
    { key: "bonus", label: "Bonus" },
  ],
  MID: [
    { key: "goals", label: "Goals" },
    { key: "assists", label: "Assists" },
    { key: "involvements", label: "G+A" },
    { key: "bonus", label: "Bonus" },
  ],
  FWD: [
    { key: "goals", label: "Goals" },
    { key: "assists", label: "Assists" },
    { key: "shots", label: "Shots" },
    { key: "bonus", label: "Bonus" },
  ],
};

function seasonColumnsFor(position: string): SeasonStatColumn[] {
  const normalized = position.toUpperCase() as PositionCode;
  return POSITION_SEASON_COLUMNS[normalized] ?? POSITION_SEASON_COLUMNS.MID;
}

// Claude is asked to separate paragraphs with a blank line; this falls back
// gracefully (single newline, then sentence-grouping) in case it doesn't.
function splitIntoParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  let paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  paragraphs = trimmed
    .split(/\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)/g) ?? [trimmed];
  if (sentences.length < 4) return [trimmed];

  const targetParagraphs = sentences.length >= 5 ? 3 : 2;
  const perParagraph = Math.ceil(sentences.length / targetParagraphs);
  const grouped: string[] = [];
  for (let i = 0; i < sentences.length; i += perParagraph) {
    grouped.push(sentences.slice(i, i + perParagraph).join("").trim());
  }
  return grouped.filter(Boolean);
}

function BreakdownItem({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-semibold text-foreground">
        {value} pts{note && <span className="ml-1 font-normal text-muted">({note})</span>}
      </p>
    </div>
  );
}

export function PlayerModal({
  player,
  insight,
  loadingInsight,
  insightError,
  onClose,
}: {
  player: SquadPlayer;
  insight: PlayerInsight | null;
  loadingInsight: boolean;
  insightError: string;
  onClose: () => void;
}) {
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set());

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function toggleSeason(seasonLabel: string) {
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonLabel)) next.delete(seasonLabel);
      else next.add(seasonLabel);
      return next;
    });
  }

  // Most recent season first for display; trend arrows still need the
  // chronologically-prior season, which is the NEXT entry in this reversed
  // order rather than the previous one.
  const displaySeasons = insight ? [...insight.fplSeasons].reverse() : [];
  const columnCount = seasonColumnsFor(player.position).length + 2; // + season + points

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-card-border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {player.position} &middot; {player.club}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-foreground">
              {player.name}
              {player.isCaptain && <span className="ml-1.5 text-accent">(C)</span>}
              {player.isViceCaptain && <span className="ml-1.5 text-muted">(V)</span>}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-lg leading-none text-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <StatBlock label="Price" value={`£${player.price}m`} />
          <StatBlock label="Form" value={String(player.form)} />
          <StatBlock label="Total points" value={String(player.totalPoints)} />
          <StatBlock label="Status" value={player.flag} />
        </div>

        {player.news && (
          <p className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {player.news}
          </p>
        )}

        {!loadingInsight && !insightError && insight?.matchContext && (
          <div className="mt-5 border-t border-card-border pt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">Match context</p>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted">Injury / suspension</span>
                {insight.matchContext.injury ? (
                  <div className="text-right">
                    <span className="inline-flex items-center rounded-full bg-red-800/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-100">
                      {insight.matchContext.injury.type}
                    </span>
                    <p className="mt-1 text-xs text-foreground">{insight.matchContext.injury.reason}</p>
                    <p className="text-[10px] text-muted">
                      as of {formatShortDate(insight.matchContext.injury.asOf)}
                    </p>
                  </div>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                    No designation
                  </span>
                )}
              </div>

              <div className="flex items-start justify-between gap-3">
                <span className="text-muted">
                  {insight.matchContext.lineup
                    ? `Next: ${insight.matchContext.lineup.isHome ? "vs" : "at"} ${insight.matchContext.lineup.opponentName} (${formatShortDate(insight.matchContext.lineup.kickoff)})`
                    : "Expected lineup"}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${lineupBadgeClasses(insight.matchContext.lineup?.status ?? "unknown")}`}
                >
                  {lineupLabel(insight.matchContext.lineup?.status ?? "unknown")}
                </span>
              </div>

              {insight.matchContext.restDays?.restDays != null && (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted">Rest before next match</span>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${restDaysBadgeClasses(insight.matchContext.restDays.restDays)}`}
                  >
                    {insight.matchContext.restDays.restDays} day
                    {insight.matchContext.restDays.restDays === 1 ? "" : "s"} rest
                  </span>
                </div>
              )}

              <div>
                <span className="text-muted">
                  {insight.matchContext.headToHead
                    ? `Last ${insight.matchContext.headToHead.played} vs ${insight.matchContext.headToHead.opponentName}`
                    : "Head-to-head"}
                </span>
                {insight.matchContext.headToHead && insight.matchContext.headToHead.played > 0 ? (
                  <p className="mt-1 text-foreground">
                    {insight.matchContext.headToHead.wins}W {insight.matchContext.headToHead.draws}D{" "}
                    {insight.matchContext.headToHead.losses}L &middot; {insight.matchContext.headToHead.goalsFor}-
                    {insight.matchContext.headToHead.goalsAgainst} goals
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted">No recent meetings on record.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {!loadingInsight && !insightError && insight && insight.fplSeasons.length > 0 && (
          <div className="mt-5 border-t border-card-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted">
                Last {insight.fplSeasons.length} seasons
              </p>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${minutesBadgeClasses(insight.minutesTrend.direction)}`}
              >
                Minutes {minutesTrendLabel(insight.minutesTrend)}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted">
                    <th className="pb-1 text-left font-semibold">Season</th>
                    {seasonColumnsFor(player.position).map((col) => (
                      <th key={col.key} className="pb-1 text-right font-semibold">
                        {col.label}
                      </th>
                    ))}
                    <th className="pb-1 text-right font-semibold">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {displaySeasons.map((row, index) => {
                    // Reversed for display, so the chronologically-prior
                    // season for trend arrows is the next array entry.
                    const previous = displaySeasons[index + 1];
                    const expanded = expandedSeasons.has(row.seasonLabel);
                    const breakdown = estimatePointsBreakdown(player.position, row);

                    return (
                      <Fragment key={row.seasonLabel}>
                        <tr
                          onClick={() => toggleSeason(row.seasonLabel)}
                          className="cursor-pointer border-t border-card-border/50 hover:bg-white/5"
                        >
                          <td className="py-1.5 text-foreground">
                            <span className="mr-1 inline-block w-3 text-muted">
                              {expanded ? "▾" : "▸"}
                            </span>
                            {row.seasonLabel}
                          </td>
                          {seasonColumnsFor(player.position).map((col) => {
                            if (col.key === "shots") {
                              return (
                                <td key={col.key} className="py-1.5 text-right text-muted">
                                  &mdash;
                                </td>
                              );
                            }
                            const value = row[col.key];
                            const previousValue = previous?.[col.key];
                            return (
                              <td key={col.key} className="py-1.5 text-right text-foreground">
                                {value}
                                {previous && previousValue !== undefined && (
                                  <TrendArrow
                                    current={value}
                                    previous={previousValue}
                                    invert={col.invert}
                                  />
                                )}
                              </td>
                            );
                          })}
                          <td className="py-1.5 text-right font-semibold text-foreground">
                            {row.totalPoints}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-background/30">
                            <td colSpan={columnCount} className="px-1 pb-3">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 sm:grid-cols-3">
                                <BreakdownItem
                                  label="Appearance"
                                  value={breakdown.appearancePoints}
                                  note={`~${breakdown.estimatedMatches} apps`}
                                />
                                <BreakdownItem label="Clean sheet" value={breakdown.cleanSheetPoints} />
                                <BreakdownItem label="Goals" value={breakdown.goalPoints} />
                                <BreakdownItem label="Assists" value={breakdown.assistPoints} />
                                <BreakdownItem label="Bonus" value={breakdown.bonusPoints} />
                              </div>
                              <p className="mt-2 text-[10px] text-muted">
                                Estimated total: {breakdown.estimatedTotal} pts &middot; actual:{" "}
                                {breakdown.actualTotal} pts. Estimate is approximate — it excludes
                                save points, cards and other minor categories.
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {player.position.toUpperCase() === "FWD" && (
                <p className="mt-2 text-[10px] text-muted">
                  Shot counts aren&apos;t available from our current data sources.
                </p>
              )}
            </div>
          </div>
        )}

        {!loadingInsight && !insightError && insight && insight.fplSeasons.length === 0 && (
          <div className="mt-5 border-t border-card-border pt-4">
            <p className="text-xs font-bold uppercase tracking-widest text-muted">
              Season history
            </p>
            <p className="mt-2 text-sm text-muted">
              No official FPL season history for this player yet — likely new to the Premier
              League.
            </p>
          </div>
        )}

        <div className="mt-5 border-t border-card-border pt-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted">
            3-season trend &amp; verdict
          </p>

          {loadingInsight && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-card-border border-t-accent" />
              Analyzing...
            </div>
          )}

          {!loadingInsight && insightError && (
            <p className="mt-3 text-sm text-red-300">{insightError}</p>
          )}

          {!loadingInsight && !insightError && insight && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${trendBadgeClasses(insight.trend.direction)}`}
                >
                  {trendLabel(insight.trend)}
                </span>
                {trendSeasonsText(insight.trend) && (
                  <span className="text-xs text-muted">{trendSeasonsText(insight.trend)}</span>
                )}
              </div>
              <div className="mt-3 space-y-3">
                {splitIntoParagraphs(insight.summary).map((paragraph, index) => (
                  <p key={index} className="text-sm leading-relaxed text-foreground/90">
                    {paragraph}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-card-border/70 bg-background/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground">{value}</p>
    </div>
  );
}
