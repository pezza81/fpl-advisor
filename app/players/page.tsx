"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SquadPlayer } from "@/lib/fpl";
import { usePlayerInsight } from "@/lib/use-player-insight";
import { PlayerModal } from "@/components/PlayerModal";

interface PlayersResponse {
  players: SquadPlayer[];
  error?: string;
}

type SortKey = "name" | "club" | "position" | "price" | "form" | "totalPoints" | "status";
type SortDirection = "asc" | "desc";

const POSITIONS = ["All", "GKP", "DEF", "MID", "FWD"] as const;

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

function statusBadgeClasses(status: string): string {
  if (status === "a") return "bg-accent/15 text-accent";
  if (status === "d") return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<SquadPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("All");
  const [club, setClub] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("totalPoints");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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

    fetch("/api/players")
      .then(async (res) => {
        const data = (await res.json()) as PlayersResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load players.");
        if (!cancelled) setPlayers(data.players);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clubs = useMemo(
    () => ["All", ...Array.from(new Set(players.map((p) => p.club))).sort()],
    [players],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns read better starting high-to-low; text columns A-Z.
      setSortDirection(key === "name" || key === "club" || key === "position" ? "asc" : "desc");
    }
  }

  const visiblePlayers = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = players.filter((player) => {
      if (query && !player.name.toLowerCase().includes(query)) return false;
      if (position !== "All" && player.position !== position) return false;
      if (club !== "All" && player.club !== club) return false;
      return true;
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let result: number;
      switch (sortKey) {
        case "name":
          result = a.name.localeCompare(b.name);
          break;
        case "club":
          result = a.club.localeCompare(b.club);
          break;
        case "position":
          result = a.position.localeCompare(b.position);
          break;
        case "status":
          result = statusLabel(a.status).localeCompare(statusLabel(b.status));
          break;
        case "price":
          result = a.price - b.price;
          break;
        case "form":
          result = a.form - b.form;
          break;
        case "totalPoints":
          result = a.totalPoints - b.totalPoints;
          break;
      }
      return result * direction;
    });
  }, [players, search, position, club, sortKey, sortDirection]);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
          &larr; Back
        </Link>
        <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
          Trends analysis &rarr;
        </Link>
      </div>

      <header className="mt-4 flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-foreground">All Players</h1>
        <p className="text-muted">
          Every player in the game — search, filter and sort, then click anyone for the same
          AI-backed detail view as your squad.
        </p>
      </header>

      {loading && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
          <p>Loading players...</p>
        </div>
      )}

      {!loading && error && (
        <div className="mt-16 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

          <p className="mt-3 text-xs text-muted">
            {visiblePlayers.length} of {players.length} players
          </p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-card-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                  <SortableHeader label="Name" sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Club" sortKey="club" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Pos" sortKey="position" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Price" sortKey="price" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} align="right" />
                  <SortableHeader label="Form" sortKey="form" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} align="right" />
                  <SortableHeader label="Points" sortKey="totalPoints" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} align="right" />
                  <SortableHeader label="Status" sortKey="status" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {visiblePlayers.map((player) => (
                  <tr
                    key={player.id}
                    onClick={() => openPlayerModal(player)}
                    className="cursor-pointer border-b border-card-border/50 transition-colors last:border-b-0 hover:bg-white/5"
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
                  </tr>
                ))}
                {visiblePlayers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted">
                      No players match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = activeKey === sortKey;

  return (
    <th className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          isActive ? "text-accent" : "text-muted"
        }`}
      >
        {label}
        {isActive && <span>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
