"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SquadPlayer } from "@/lib/fpl";
import { statusBadgeClasses, statusLabel } from "@/lib/player-status";
import {
  canAddPlayer,
  computeSquadTotals,
  POSITION_ORDER,
  POSITION_QUOTAS,
  SQUAD_BUDGET,
} from "@/lib/squad-rules";

interface PlayersResponse {
  players: SquadPlayer[];
  error?: string;
}

interface BuildSquadResponse {
  squad: SquadPlayer[];
  rationale: string;
  usedFallback: boolean;
  error?: string;
}

interface AdviceResponse {
  transfer: string;
  captain: string;
  chip: string;
  actions: string[];
  error?: string;
}

const POSITIONS = ["All", "GKP", "DEF", "MID", "FWD"] as const;

export default function BuildPage() {
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [playersError, setPlayersError] = useState("");

  const [squad, setSquad] = useState<SquadPlayer[]>([]);
  const [addError, setAddError] = useState("");

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("All");
  const [club, setClub] = useState("All");

  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [rationale, setRationale] = useState("");

  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [adviceError, setAdviceError] = useState("");
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    fetch("/api/players")
      .then(async (res) => {
        const data = (await res.json()) as PlayersResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load players.");
        if (!cancelled) setPlayers(data.players);
      })
      .catch((err: Error) => {
        if (!cancelled) setPlayersError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingPlayers(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => computeSquadTotals(squad), [squad]);
  const squadIds = useMemo(() => new Set(squad.map((p) => p.id)), [squad]);

  const clubs = useMemo(
    () => ["All", ...Array.from(new Set(players.map((p) => p.club))).sort()],
    [players],
  );

  const visiblePlayers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return players
      .filter((player) => {
        if (query && !player.name.toLowerCase().includes(query)) return false;
        if (position !== "All" && player.position !== position) return false;
        if (club !== "All" && player.club !== club) return false;
        return true;
      })
      .sort((a, b) => b.totalPoints - a.totalPoints);
  }, [players, search, position, club]);

  function handleAdd(player: SquadPlayer) {
    const check = canAddPlayer(squad, player);
    if (!check.ok) {
      setAddError(check.reason ?? "Can't add that player.");
      return;
    }
    setAddError("");
    setSquad((prev) => [...prev, player]);
  }

  function handleRemove(playerId: number) {
    setAddError("");
    setSquad((prev) => prev.filter((p) => p.id !== playerId));
  }

  function handleClear() {
    setSquad([]);
    setAddError("");
    setRationale("");
    setSuggestError("");
    setAdvice(null);
    setAdviceError("");
    setCheckedActions(new Set());
  }

  async function handleSuggest() {
    setSuggesting(true);
    setSuggestError("");
    setAdvice(null);
    setAdviceError("");
    setCheckedActions(new Set());

    try {
      const res = await fetch("/api/build-squad", { method: "POST" });
      const data = (await res.json()) as BuildSquadResponse;
      if (!res.ok) throw new Error(data.error ?? "Failed to suggest a squad.");
      setSquad(data.squad);
      setRationale(data.rationale);
      setAddError("");
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleGetAdvice() {
    setLoadingAdvice(true);
    setAdviceError("");
    setAdvice(null);
    setCheckedActions(new Set());

    try {
      const res = await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: "My Build",
          bank: totals.remaining,
          squadValue: totals.spent,
          squad,
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

  const budgetPercent = Math.min(100, (totals.spent / SQUAD_BUDGET) * 100);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
          &larr; Back
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/players" className="text-sm text-muted transition-colors hover:text-accent">
            All players
          </Link>
          <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
            Trends analysis &rarr;
          </Link>
        </div>
      </div>

      <header className="mt-4 flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-foreground">Build Your Squad</h1>
        <p className="text-muted">
          Pick your 15-man opening squad within a £{SQUAD_BUDGET}m budget, or let Claude suggest one
          using season points, 3-season trends and real xG-based club strength.
        </p>
      </header>

      {/* Budget tracker */}
      <section className="mt-6 rounded-xl border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted">
            <span className="text-2xl font-bold text-foreground">£{totals.spent}m</span> spent
          </p>
          <p
            className={`text-sm font-semibold ${totals.remaining < 0 ? "text-red-400" : "text-accent"}`}
          >
            £{totals.remaining}m remaining
          </p>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-background">
          <div
            className={`h-full rounded-full transition-all ${totals.remaining < 0 ? "bg-red-500" : "bg-accent-strong"}`}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
          {POSITION_ORDER.map((pos) => (
            <span key={pos} className="font-medium">
              {pos}{" "}
              <span
                className={
                  totals.positionCounts[pos] === POSITION_QUOTAS[pos]
                    ? "text-accent"
                    : "text-foreground"
                }
              >
                {totals.positionCounts[pos] ?? 0}/{POSITION_QUOTAS[pos]}
              </span>
            </span>
          ))}
          <span className="font-medium">
            Total{" "}
            <span className={totals.isComplete ? "text-accent" : "text-foreground"}>
              {squad.length}/15
            </span>
          </span>
        </div>
      </section>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSuggest}
          disabled={suggesting}
          className="rounded-lg bg-accent-strong px-6 py-2.5 font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {suggesting ? "Thinking it through..." : "AI suggest my squad"}
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={squad.length === 0}
          className="rounded-lg border border-card-border px-6 py-2.5 font-medium text-muted transition-colors hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear squad
        </button>
      </div>

      {suggestError && (
        <p className="mt-3 text-sm text-red-400">{suggestError}</p>
      )}
      {addError && <p className="mt-3 text-sm text-red-400">{addError}</p>}
      {rationale && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm leading-relaxed text-foreground">
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-accent">
            Why this squad
          </p>
          {rationale}
        </div>
      )}

      {/* Selected squad */}
      <section className="mt-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Your squad</h2>
        {squad.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-card-border p-6 text-center text-sm text-muted">
            Your squad is empty — add players below or let Claude suggest one.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {POSITION_ORDER.map((pos) => {
              const positionPlayers = squad.filter((p) => p.position === pos);
              if (positionPlayers.length === 0) return null;
              return (
                <div key={pos}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {pos} ({positionPlayers.length}/{POSITION_QUOTAS[pos]})
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {positionPlayers.map((player) => (
                      <div
                        key={player.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {player.name}
                          </p>
                          <p className="text-xs text-muted">
                            {player.club} &middot; £{player.price}m
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemove(player.id)}
                          aria-label={`Remove ${player.name}`}
                          className="shrink-0 text-muted transition-colors hover:text-red-400"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Complete-squad summary + advice */}
      {totals.isComplete && (
        <section className="mt-6 rounded-xl border border-accent/40 bg-accent/5 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-accent">Squad complete</p>
          <p className="mt-2 text-sm text-foreground">
            15/15 players &middot; £{totals.spent}m spent &middot; £{totals.remaining}m left in the
            bank
          </p>
          <button
            type="button"
            onClick={handleGetAdvice}
            disabled={loadingAdvice}
            className="mt-4 rounded-lg bg-accent-strong px-6 py-2.5 font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingAdvice ? "Thinking it through..." : "Get AI advice on this squad"}
          </button>

          {adviceError && <p className="mt-3 text-sm text-red-400">{adviceError}</p>}

          {advice && (
            <>
              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                <AdviceCard title="Transfer" body={advice.transfer} tone="green" />
                <AdviceCard title="Captain" body={advice.captain} tone="red" />
                <AdviceCard title="Chip" body={advice.chip} tone="blue" />
              </div>

              {advice.actions.length > 0 && (
                <div className="mt-4 rounded-xl border border-card-border bg-card p-5">
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
                            <span className={checked ? "text-muted line-through" : "text-foreground"}>
                              {action}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Player picker */}
      <section className="mt-10">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted">Add players</h2>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            placeholder="Search players..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-card-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent sm:max-w-xs"
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-card-border">
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setPosition(pos)}
                  className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                    position === pos
                      ? "bg-accent-strong text-[#04140b]"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>

            <select
              value={club}
              onChange={(event) => setClub(event.target.value)}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-xs font-medium text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {clubs.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loadingPlayers && (
          <div className="mt-10 flex flex-col items-center gap-3 text-muted">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
            <p>Loading players...</p>
          </div>
        )}

        {!loadingPlayers && playersError && (
          <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
            {playersError}
          </div>
        )}

        {!loadingPlayers && !playersError && (
          <div className="mt-3 overflow-x-auto rounded-xl border border-card-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-semibold">Club</th>
                  <th className="px-3 py-2 text-left font-semibold">Pos</th>
                  <th className="px-3 py-2 text-right font-semibold">Price</th>
                  <th className="px-3 py-2 text-right font-semibold">Form</th>
                  <th className="px-3 py-2 text-right font-semibold">Points</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visiblePlayers.slice(0, 100).map((player) => {
                  const inSquad = squadIds.has(player.id);
                  const check = inSquad ? { ok: true } : canAddPlayer(squad, player);
                  return (
                    <tr
                      key={player.id}
                      className="border-b border-card-border/50 last:border-b-0 hover:bg-white/5"
                    >
                      <td className="px-3 py-2.5 font-medium text-foreground">{player.name}</td>
                      <td className="px-3 py-2.5 text-muted">{player.club}</td>
                      <td className="px-3 py-2.5 text-muted">{player.position}</td>
                      <td className="px-3 py-2.5 text-right text-foreground">£{player.price}m</td>
                      <td className="px-3 py-2.5 text-right text-foreground">{player.form}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-foreground">
                        {player.totalPoints}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClasses(player.status)}`}
                        >
                          {statusLabel(player.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {inSquad ? (
                          <button
                            type="button"
                            onClick={() => handleRemove(player.id)}
                            className="rounded-md border border-card-border px-3 py-1 text-xs font-semibold text-muted transition-colors hover:border-red-500/50 hover:text-red-400"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAdd(player)}
                            disabled={!check.ok}
                            title={check.ok ? undefined : check.reason}
                            className="rounded-md bg-accent-strong px-3 py-1 text-xs font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-card disabled:text-muted"
                          >
                            Add
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visiblePlayers.length > 100 && (
              <p className="border-t border-card-border px-3 py-2 text-center text-xs text-muted">
                Showing top 100 of {visiblePlayers.length} matching players — refine your search or
                filters to see more.
              </p>
            )}
          </div>
        )}
      </section>
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
      <h3 className={`text-xs font-bold uppercase tracking-widest ${titleClasses}`}>{title}</h3>
      <p className="mt-3 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
