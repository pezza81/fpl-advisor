"use client";

import Link from "next/link";
import { Fragment, use, useEffect, useRef, useState } from "react";
import type { SquadPlayer, TeamData } from "@/lib/fpl";
import type { MinutesTrend, PlayerTrend } from "@/lib/football-trends";
import { estimatePointsBreakdown, type FplSeasonRow } from "@/lib/fpl-history";

interface TeamResponse extends TeamData {
  error?: string;
}

interface AdviceResponse {
  transfer: string;
  captain: string;
  chip: string;
  actions: string[];
  error?: string;
}

interface PlayerInsight {
  trend: PlayerTrend;
  minutesTrend: MinutesTrend;
  fplSeasons: FplSeasonRow[];
  summary: string;
  error?: string;
}

export default function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // Keyed on id so navigating to a different team ID remounts this
  // component instead of resetting state imperatively inside an effect.
  return <TeamPageContent key={id} id={id} />;
}

function TeamPageContent({ id }: { id: string }) {
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [teamError, setTeamError] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);

  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [adviceError, setAdviceError] = useState("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());

  const [selectedPlayer, setSelectedPlayer] = useState<SquadPlayer | null>(null);
  const [insightCache, setInsightCache] = useState<Map<number, PlayerInsight>>(new Map());
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [insightError, setInsightError] = useState("");
  const activePlayerIdRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/team?teamId=${id}`)
      .then(async (res) => {
        const data = (await res.json()) as TeamResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load team.");
        if (!cancelled) setTeam(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setTeamError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingTeam(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleGetAdvice() {
    if (!team) return;
    setLoadingAdvice(true);
    setAdviceError("");
    setAdvice(null);
    setCheckedActions(new Set());

    try {
      const res = await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: team.teamName,
          gameweek: team.gameweek,
          bank: team.bank,
          squadValue: team.squadValue,
          squad: team.squad,
        }),
      });
      const data = (await res.json()) as AdviceResponse;
      if (!res.ok) throw new Error(data.error ?? "Failed to generate advice.");
      setAdvice(data);
    } catch (err) {
      setAdviceError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingAdvice(false);
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

  function openPlayerModal(player: SquadPlayer) {
    setSelectedPlayer(player);
    setInsightError("");
    activePlayerIdRef.current = player.id;

    if (insightCache.has(player.id)) return;

    setLoadingInsight(true);
    fetch("/api/player-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: player.id,
        name: player.name,
        position: player.position,
        club: player.club,
        price: player.price,
        form: player.form,
        totalPoints: player.totalPoints,
        news: player.news || undefined,
      }),
    })
      .then(async (res) => {
        const data = (await res.json()) as PlayerInsight;
        if (!res.ok) throw new Error(data.error ?? "Failed to load player insight.");
        setInsightCache((prev) => new Map(prev).set(player.id, data));
      })
      .catch((err: Error) => {
        if (activePlayerIdRef.current === player.id) setInsightError(err.message);
      })
      .finally(() => {
        if (activePlayerIdRef.current === player.id) setLoadingInsight(false);
      });
  }

  function closePlayerModal() {
    setSelectedPlayer(null);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
          &larr; Back
        </Link>
        <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
          Trends analysis &rarr;
        </Link>
      </div>

      {loadingTeam && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
          <p>Loading your squad...</p>
        </div>
      )}

      {!loadingTeam && teamError && (
        <div className="mt-16 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
          {teamError}
        </div>
      )}

      {!loadingTeam && team && (
        <>
          <header className="mt-4 flex flex-col gap-1">
            {team.isDemo && (
              <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Demo squad
              </span>
            )}
            <h1 className="text-3xl font-bold text-foreground">{team.teamName}</h1>
            <p className="text-muted">
              {team.managerName} &middot; Gameweek {team.gameweek} &middot;{" "}
              {team.overallPoints} pts &middot; Rank{" "}
              {team.overallRank.toLocaleString()}
            </p>
            <p className="text-sm text-muted">
              Squad value £{team.squadValue}m &middot; Bank £{team.bank}m
            </p>
          </header>

          <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {team.squad.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => openPlayerModal(player)}
                className={`relative rounded-lg border bg-card p-4 text-left transition-colors hover:border-accent/60 ${
                  player.isStarting ? "border-card-border" : "border-card-border/50 opacity-70"
                }`}
              >
                <span
                  className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    player.flag === "KEEP"
                      ? "bg-accent/15 text-accent"
                      : "bg-red-500/15 text-red-400"
                  }`}
                >
                  {player.flag}
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {player.position} &middot; {player.club}
                </p>
                <p className="mt-1 pr-10 font-semibold text-foreground">
                  {player.name}
                  {player.isCaptain && <span className="ml-1 text-accent">(C)</span>}
                  {player.isViceCaptain && <span className="ml-1 text-muted">(V)</span>}
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>£{player.price}m</span>
                  <span>Form {player.form}</span>
                  <span>{player.totalPoints} pts</span>
                </div>
                {!player.isStarting && (
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-muted">Bench</p>
                )}
              </button>
            ))}
          </section>

          <div className="mt-10 flex justify-center">
            <button
              onClick={handleGetAdvice}
              disabled={loadingAdvice}
              className="rounded-lg bg-accent-strong px-8 py-3 font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingAdvice ? "Thinking it through..." : "Get AI Advice"}
            </button>
          </div>

          {adviceError && (
            <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-center text-red-300">
              {adviceError}
            </div>
          )}

          {advice && (
            <>
              <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
                <AdviceCard title="Transfer" body={advice.transfer} tone="green" />
                <AdviceCard title="Captain" body={advice.captain} tone="red" />
                <AdviceCard title="Chip" body={advice.chip} tone="blue" />
              </section>

              {advice.actions.length > 0 && (
                <section className="mt-6 rounded-xl border border-card-border bg-card p-5">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
                    Your gameweek actions
                  </h3>
                  <ul className="mt-4 flex flex-col gap-2.5">
                    {advice.actions.map((action, index) => {
                      const checked = checkedActions.has(index);
                      return (
                        <li key={index}>
                          <label className="flex cursor-pointer items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleAction(index)}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-accent-strong"
                            />
                            <span
                              className={
                                checked ? "text-muted line-through" : "text-foreground"
                              }
                            >
                              {action}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}

      {selectedPlayer && (
        <PlayerModal
          key={selectedPlayer.id}
          player={selectedPlayer}
          insight={insightCache.get(selectedPlayer.id) ?? null}
          loadingInsight={loadingInsight}
          insightError={insightError}
          onClose={closePlayerModal}
        />
      )}
    </div>
  );
}

function AdviceCard({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "green" | "red" | "blue";
}) {
  const toneClasses = {
    green: "border-emerald-800/60 bg-emerald-950/30 text-emerald-100",
    red: "border-rose-800/60 bg-rose-950/30 text-rose-100",
    blue: "border-sky-800/60 bg-sky-950/30 text-sky-100",
  }[tone];

  const titleClasses = {
    green: "text-emerald-400",
    red: "text-rose-400",
    blue: "text-sky-400",
  }[tone];

  return (
    <div className={`rounded-xl border p-5 ${toneClasses}`}>
      <h3 className={`text-xs font-bold uppercase tracking-widest ${titleClasses}`}>
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function trendBadgeClasses(direction: PlayerTrend["direction"]): string {
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

function trendLabel(trend: PlayerTrend): string {
  if (trend.direction === "rising") return "Rising ↑";
  if (trend.direction === "declining") return "Declining ↓";
  if (trend.direction === "stable") return "Stable";
  return "No historical data";
}

function trendSeasonsText(trend: PlayerTrend): string | null {
  if (trend.previousSeason == null || trend.latestSeason == null) return null;
  return `${trend.previousSeason}: ${trend.previousOutput} G+A → ${trend.latestSeason}: ${trend.latestOutput} G+A`;
}

function minutesBadgeClasses(direction: MinutesTrend["direction"]): string {
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

function minutesTrendLabel(trend: MinutesTrend): string {
  if (trend.direction === "increasing") return "Increasing ↑";
  if (trend.direction === "decreasing") return "Decreasing ↓";
  if (trend.direction === "stable") return "Stable";
  return "Unknown";
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

function PlayerModal({
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
          <StatBlock label="Squad status" value={player.flag} />
        </div>

        {player.news && (
          <p className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {player.news}
          </p>
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
