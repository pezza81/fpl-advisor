"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { SquadPlayer } from "@/lib/fpl";
import type { LeagueData, LeagueManagerRow } from "@/lib/league-types";

interface LeagueResponse extends LeagueData {
  error?: string;
}

interface ChatMessage {
  id: string;
  author: string;
  text: string;
  timestamp: string;
  isAi?: boolean;
}

// ---- helpers ----------------------------------------------------------------

function movementGlyph(movement: LeagueManagerRow["movement"]): string {
  if (movement === "up") return "↑";
  if (movement === "down") return "↓";
  if (movement === "new") return "NEW";
  return "→";
}

function movementColorClass(movement: LeagueManagerRow["movement"]): string {
  if (movement === "up") return "text-emerald-400";
  if (movement === "down") return "text-red-400";
  if (movement === "new") return "text-accent";
  return "text-muted";
}

function scoreColorClass(score: number): string {
  if (score >= 7) return "bg-emerald-800/70 text-emerald-100";
  if (score >= 4) return "bg-amber-800/70 text-amber-100";
  return "bg-red-800/70 text-red-100";
}

function chatStorageKey(leagueId: string): string {
  return `fpl-advisor:league-chat:${leagueId}`;
}

function chatNameStorageKey(): string {
  return "fpl-advisor:chat-name";
}

function loadChatMessages(leagueId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(chatStorageKey(leagueId));
    if (raw) return JSON.parse(raw) as ChatMessage[];
  } catch {
    // ignore malformed/unavailable storage
  }
  return [];
}

function saveChatMessages(leagueId: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(chatStorageKey(leagueId), JSON.stringify(messages));
  } catch {
    // localStorage unavailable — chat just won't persist this session
  }
}

function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ---- small components --------------------------------------------------------

function CompactPlayerCard({ player }: { player: SquadPlayer }) {
  return (
    <div className="rounded-lg border border-card-border/70 bg-background/40 p-2">
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted">
          {player.position} &middot; {player.club}
        </p>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
            player.flag === "KEEP" ? "bg-accent/15 text-accent" : "bg-red-500/15 text-red-400"
          }`}
        >
          {player.flag}
        </span>
      </div>
      <p className="truncate text-xs font-semibold text-foreground">
        {player.name}
        {player.isCaptain && <span className="ml-1 text-accent">(C)</span>}
        {player.isViceCaptain && <span className="ml-1 text-muted">(V)</span>}
      </p>
      <p className="text-[10px] text-muted">
        £{player.price}m &middot; {player.totalPoints}pts
      </p>
    </div>
  );
}

function ManagerRow({
  manager,
  isExpanded,
  onToggle,
}: {
  manager: LeagueManagerRow;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-t border-card-border/50 transition-colors hover:bg-white/5"
      >
        <td className="py-2.5 pr-2 text-foreground">{manager.rank}</td>
        <td className={`py-2.5 pr-3 font-semibold ${movementColorClass(manager.movement)}`}>
          {movementGlyph(manager.movement)}
        </td>
        <td className="py-2.5 pr-3 font-semibold text-foreground">{manager.entryName}</td>
        <td className="py-2.5 pr-3 text-muted">{manager.managerName}</td>
        <td className="py-2.5 pr-3 text-right font-semibold text-foreground">{manager.total}</td>
        <td className="py-2.5 pr-3 text-right text-foreground">{manager.eventTotal}</td>
        <td className="py-2.5 text-right">
          {manager.weekAheadScore != null ? (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${scoreColorClass(manager.weekAheadScore)}`}
              title={manager.weekAheadReason ?? undefined}
            >
              {manager.weekAheadScore}/10
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-background/30">
          <td colSpan={7} className="px-3 pb-4 pt-2">
            {manager.weekAheadReason && (
              <p className="mb-3 text-xs text-muted">
                <span className="font-semibold text-foreground">Week ahead:</span>{" "}
                {manager.weekAheadReason}
              </p>
            )}
            {manager.squad.length === 0 ? (
              <p className="text-xs text-muted">No squad data available for this manager yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                {manager.squad.map((player) => (
                  <CompactPlayerCard key={player.id} player={player} />
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ChatPanel({ leagueId, managers }: { leagueId: string; managers: LeagueManagerRow[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatMessages(leagueId));
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(chatNameStorageKey()) ?? "You";
    } catch {
      return "You";
    }
  });
  const [draft, setDraft] = useState("");
  const [askingAi, setAskingAi] = useState(false);
  const [aiError, setAiError] = useState("");

  function persist(next: ChatMessage[]) {
    setMessages(next);
    saveChatMessages(leagueId, next);
  }

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    persist([
      ...messages,
      { id: crypto.randomUUID(), author: name.trim() || "You", text, timestamp: new Date().toISOString() },
    ]);
    setDraft("");
  }

  function handleNameChange(value: string) {
    setName(value);
    try {
      localStorage.setItem(chatNameStorageKey(), value);
    } catch {
      // ignore
    }
  }

  async function handleAskAi() {
    setAskingAi(true);
    setAiError("");

    try {
      const res = await fetch("/api/league-commentary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueName: "this league",
          managers: managers.map((manager) => ({
            entryName: manager.entryName,
            managerName: manager.managerName,
            rank: manager.rank,
            total: manager.total,
            eventTotal: manager.eventTotal,
            squad: manager.squad,
          })),
        }),
      });
      const data = (await res.json()) as { commentary?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to get AI commentary.");

      persist([
        ...messages,
        {
          id: crypto.randomUUID(),
          author: "FPL AI",
          text: data.commentary ?? "",
          timestamp: new Date().toISOString(),
          isAi: true,
        },
      ]);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setAskingAi(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-card-border bg-card">
      <div className="border-b border-card-border p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted">League chat</h2>
        <input
          type="text"
          value={name}
          onChange={(event) => handleNameChange(event.target.value)}
          placeholder="Your name"
          className="mt-2 w-full rounded-md border border-card-border bg-background/40 px-2 py-1 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 420 }}>
        {messages.length === 0 && (
          <p className="text-xs text-muted">
            No messages yet — say something to your league, or ask the AI for its take.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.isAi ? "rounded-lg border border-accent/30 bg-accent/5 p-2.5" : ""}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-xs font-semibold ${message.isAi ? "text-accent" : "text-foreground"}`}>
                {message.author}
              </span>
              <span className="text-[10px] text-muted">{formatChatTime(message.timestamp)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">{message.text}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-card-border p-4">
        {aiError && <p className="mb-2 text-xs text-red-400">{aiError}</p>}
        <button
          type="button"
          onClick={handleAskAi}
          disabled={askingAi || managers.length === 0}
          className="mb-2 w-full rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {askingAi ? "Thinking it through..." : "Ask AI for league banter"}
        </button>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSend();
            }}
            placeholder="Say something..."
            className="w-full rounded-lg border border-card-border bg-background/40 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSend}
            className="shrink-0 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-[#04140b] transition-colors hover:bg-accent"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- page --------------------------------------------------------------------

export default function LeaguePage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = use(params);
  return <LeagueContent key={leagueId} leagueId={leagueId} />;
}

function LeagueContent({ leagueId }: { leagueId: string }) {
  const [league, setLeague] = useState<LeagueResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedEntry, setExpandedEntry] = useState<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/league?leagueId=${leagueId}`)
      .then(async (res) => {
        const data = (await res.json()) as LeagueResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load league.");
        if (!cancelled) setLeague(data);
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
  }, [leagueId]);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
          &larr; Back
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/players" className="text-sm text-muted transition-colors hover:text-accent">
            All players
          </Link>
          <Link href="/build" className="text-sm text-muted transition-colors hover:text-accent">
            Build squad
          </Link>
          <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
            Trends analysis &rarr;
          </Link>
        </div>
      </div>

      {loading && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
          <p>Loading league...</p>
        </div>
      )}

      {!loading && error && (
        <div className="mt-16 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && league && (
        <>
          <header className="mt-4 flex flex-col gap-1">
            {league.isDemo && (
              <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Demo league
              </span>
            )}
            <h1 className="text-3xl font-bold text-foreground">{league.leagueName}</h1>
            {league.hasStandings && <p className="text-muted">Gameweek {league.gameweek}</p>}
          </header>

          {!league.hasStandings ? (
            <div className="mt-10 rounded-xl border border-card-border bg-card p-6 text-center">
              <p className="text-foreground">
                No standings yet for this league — check back once gameweek 1 results are in.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
              <div className="overflow-x-auto rounded-xl border border-card-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                      <th className="py-2 pl-3 pr-2 text-left font-semibold">Rank</th>
                      <th className="py-2 pr-3 text-left font-semibold">Move</th>
                      <th className="py-2 pr-3 text-left font-semibold">Team</th>
                      <th className="py-2 pr-3 text-left font-semibold">Manager</th>
                      <th className="py-2 pr-3 text-right font-semibold">Total</th>
                      <th className="py-2 pr-3 text-right font-semibold">GW</th>
                      <th className="py-2 pr-3 text-right font-semibold">Week ahead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {league.managers.map((manager) => (
                      <ManagerRow
                        key={manager.entry}
                        manager={manager}
                        isExpanded={expandedEntry === manager.entry}
                        onToggle={() =>
                          setExpandedEntry((prev) => (prev === manager.entry ? null : manager.entry))
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <ChatPanel leagueId={leagueId} managers={league.managers} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
