"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { flagBadgeClasses, flagLabel, formatRankWithTotal, rankPercentile, type SquadPlayer, type TeamData } from "@/lib/fpl";
import { usePlayerInsight } from "@/lib/use-player-insight";
import { PlayerModal } from "@/components/PlayerModal";
import { AdviceCard } from "@/components/AdviceCard";
import { ActionChecklist } from "@/components/ActionChecklist";
import { clearSavedTeamId } from "@/lib/team-id-storage";
import { clearFplSession, loadFplSession, saveFplSession } from "@/lib/fpl-session-storage";

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

const POSITION_FILTERS = ["All", "GKP", "DEF", "MID", "FWD"] as const;
type PositionFilter = (typeof POSITION_FILTERS)[number];

// FPL's own squad-sheet order (goalkeeper, then outfield positions front to
// back) — the default view and the baseline every other sort still applies
// within a position group for "By position".
const POSITION_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 };

type SortOption = "position" | "points" | "form" | "price";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "position", label: "By position" },
  { value: "points", label: "By points" },
  { value: "form", label: "By form" },
  { value: "price", label: "By price" },
];

// Bench players are filtered/sorted as their own group and rendered after a
// divider — this only ever sorts within one group (starters or bench), so
// it doesn't need to know about isStarting at all.
function sortSquad(players: SquadPlayer[], sortOption: SortOption): SquadPlayer[] {
  return [...players].sort((a, b) => {
    if (sortOption === "position") {
      const positionDiff = (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99);
      return positionDiff !== 0 ? positionDiff : b.totalPoints - a.totalPoints;
    }
    if (sortOption === "points") return b.totalPoints - a.totalPoints;
    if (sortOption === "form") return b.form - a.form;
    return b.price - a.price;
  });
}

function SquadPlayerCard({ player, onOpen }: { player: SquadPlayer; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative rounded-lg border bg-card p-4 text-left transition-colors hover:border-accent/60 ${
        player.isStarting ? "border-card-border" : "border-card-border/50 opacity-70"
      }`}
    >
      <span
        className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${flagBadgeClasses(player.flag)}`}
      >
        {flagLabel(player.flag)}
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
    </button>
  );
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
  const router = useRouter();
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [teamError, setTeamError] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);

  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [adviceError, setAdviceError] = useState("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [checkedActions, setCheckedActions] = useState<Set<number>>(new Set());
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("All");
  const [sortOption, setSortOption] = useState<SortOption>("position");

  // Deliberately not read via a lazy useState initializer: localStorage
  // doesn't exist during server rendering, so that would make the very
  // first client render disagree with the server-rendered HTML. Starting at
  // null and loading it inside an effect keeps first paint identical to SSR
  // — the connect prompt briefly shows even for an already-connected user,
  // then upgrades to "connected" a moment later, same tradeoff already used
  // for the saved-team-id redirect on the homepage.
  const [fplSession, setFplSessionState] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connectEmail, setConnectEmail] = useState("");
  const [connectPassword, setConnectPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  useEffect(() => {
    Promise.resolve().then(() => {
      const saved = loadFplSession(id);
      if (saved) setFplSessionState(saved);
    });
  }, [id]);

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

    fetch(`/api/team?teamId=${id}`, {
      headers: fplSession ? { "X-FPL-Session": fplSession } : {},
    })
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
  }, [id, fplSession]);

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

  function handleChangeTeam() {
    clearSavedTeamId();
    router.push("/");
  }

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConnecting(true);
    setConnectError("");

    try {
      const res = await fetch("/api/fpl-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: connectEmail, password: connectPassword }),
      });
      const data = (await res.json()) as { sessionCookie?: string; error?: string };
      if (!res.ok || !data.sessionCookie) throw new Error(data.error ?? "Could not sign in to FPL.");

      saveFplSession(id, data.sessionCookie);
      setFplSessionState(data.sessionCookie);
      setShowConnectForm(false);
      setConnectPassword("");
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    clearFplSession(id);
    setFplSessionState(null);
  }

  const rankTopPercent = team ? rankPercentile(team.overallRank, team.totalPlayers) : null;

  const filteredSquad = team
    ? team.squad.filter((player) => positionFilter === "All" || player.position === positionFilter)
    : [];
  const startingPlayers = sortSquad(
    filteredSquad.filter((player) => player.isStarting),
    sortOption,
  );
  const benchPlayers = sortSquad(
    filteredSquad.filter((player) => !player.isStarting),
    sortOption,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
            &larr; Back
          </Link>
          <button
            type="button"
            onClick={handleChangeTeam}
            className="text-sm text-muted transition-colors hover:text-accent"
          >
            Change team
          </button>
        </div>
        <div className="flex items-center gap-5">
          <Link href={`/dashboard/${id}`} className="text-sm text-muted transition-colors hover:text-accent">
            Dashboard
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
            {team.seasonStarted ? (
              <>
                <p className="text-muted">
                  {team.managerName} &middot; Gameweek {team.gameweek} &middot;{" "}
                  {team.overallPoints} pts &middot; Rank{" "}
                  {formatRankWithTotal(team.overallRank, team.totalPlayers)}
                  {rankTopPercent != null && <> &middot; Top {rankTopPercent}%</>}
                </p>
                <p className="text-sm text-muted">
                  Squad value £{team.squadValue}m &middot; Bank £{team.bank}m
                </p>
              </>
            ) : (
              <p className="text-muted">
                {team.managerName} &middot; {team.overallPoints} pts
              </p>
            )}
          </header>

          {!team.isDemo && (
            <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
              {team.isLive && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Live squad
                  </span>
                  <span className="text-xs text-muted">
                    Showing your real-time picks, including changes not yet locked in.
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="ml-auto shrink-0 text-xs text-muted underline decoration-muted/40 underline-offset-2 hover:text-accent"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {!team.isLive && !showConnectForm && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground">
                      {team.sessionExpired
                        ? "Your FPL session has expired."
                        : "Showing your last locked-in squad."}
                    </p>
                    <p className="text-xs text-muted">
                      Connect your FPL account to see live changes before the deadline — captain
                      swaps, bench order, and lineup changes you haven&apos;t locked in yet.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowConnectForm(true)}
                    className="shrink-0 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
                  >
                    {team.sessionExpired ? "Reconnect FPL account" : "Connect FPL account"}
                  </button>
                </div>
              )}

              {!team.isLive && showConnectForm && (
                <form onSubmit={handleConnect} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="email"
                      required
                      placeholder="FPL email"
                      value={connectEmail}
                      onChange={(event) => setConnectEmail(event.target.value)}
                      className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <input
                      type="password"
                      required
                      placeholder="FPL password"
                      value={connectPassword}
                      onChange={(event) => setConnectPassword(event.target.value)}
                      className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      type="submit"
                      disabled={connecting}
                      className="shrink-0 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connecting ? "Connecting..." : "Connect"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowConnectForm(false);
                        setConnectError("");
                      }}
                      className="shrink-0 rounded-lg border border-card-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                  {connectError && <p className="text-xs text-red-400">{connectError}</p>}
                  <p className="text-[11px] leading-relaxed text-muted">
                    Your password is sent once to verify your login and is never stored — we keep
                    only the resulting session token in your browser, which you can remove anytime
                    by disconnecting. This uses FPL&apos;s own login rather than an official public
                    API, so it can occasionally fail or stop working without notice.
                  </p>
                </form>
              )}
            </div>
          )}

          {!team.seasonStarted && (
            <div className="mt-10 rounded-xl border border-card-border bg-card p-6 text-center">
              <p className="text-foreground">
                Your gameweek squad will appear here once the season starts on 21 August. In the
                meantime, use the{" "}
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

          {team.seasonStarted && (
            <>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex overflow-hidden rounded-lg border border-card-border">
                  {POSITION_FILTERS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setPositionFilter(pos)}
                      className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                        positionFilter === pos
                          ? "bg-accent-strong text-[#04140b]"
                          : "bg-card text-muted hover:text-foreground"
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>

                <select
                  value={sortOption}
                  onChange={(event) => setSortOption(event.target.value as SortOption)}
                  className="rounded-lg border border-card-border bg-card px-3 py-2 text-xs font-medium text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <section className="mt-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {startingPlayers.map((player) => (
                    <SquadPlayerCard key={player.id} player={player} onOpen={() => openPlayerModal(player)} />
                  ))}
                </div>

                {benchPlayers.length > 0 && (
                  <>
                    <div className="mt-6 flex items-center gap-3">
                      <span className="h-px flex-1 bg-card-border" />
                      <span className="text-xs font-bold uppercase tracking-widest text-muted">Bench</span>
                      <span className="h-px flex-1 bg-card-border" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {benchPlayers.map((player) => (
                        <SquadPlayerCard key={player.id} player={player} onOpen={() => openPlayerModal(player)} />
                      ))}
                    </div>
                  </>
                )}

                {startingPlayers.length === 0 && benchPlayers.length === 0 && (
                  <p className="mt-4 text-center text-sm text-muted">No players match this filter.</p>
                )}
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

                  <ActionChecklist
                    actions={advice.actions}
                    advice={advice}
                    squadNames={team.squad.map((player) => player.name)}
                    checkedActions={checkedActions}
                    onToggle={toggleAction}
                  />
                </>
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

