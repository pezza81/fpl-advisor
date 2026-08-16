"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { TeamData } from "@/lib/fpl";
import { usePlayerInsight } from "@/lib/use-player-insight";
import { PlayerModal } from "@/components/PlayerModal";

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

  const {
    selectedPlayer,
    insightCache,
    loadingInsight,
    insightError,
    openPlayerModal,
    closePlayerModal,
  } = usePlayerInsight();

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

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
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
