"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { SquadPlayer } from "@/lib/fpl";
import type { LeagueData, LeagueManagerRow } from "@/lib/league-types";
import {
  countUnread,
  loadChatMessages,
  loadChatName,
  loadDirectMessages,
  markChatSeen,
  recordLeagueVisit,
  saveChatMessages,
  saveChatName,
  saveDirectMessages,
  type ChatMessage,
} from "@/lib/league-chat-storage";

interface LeagueResponse extends LeagueData {
  error?: string;
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

function formatChatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
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

function DirectTab({
  leagueId,
  managers,
  name,
}: {
  leagueId: string;
  managers: LeagueManagerRow[];
  name: string;
}) {
  const [selectedEntry, setSelectedEntry] = useState<string | number | null>(null);
  const [dmMessages, setDmMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");

  const selectedManager = managers.find((manager) => manager.entry === selectedEntry) ?? null;

  function selectManager(manager: LeagueManagerRow) {
    setSelectedEntry(manager.entry);
    setDmMessages(loadDirectMessages(leagueId, manager.entry));
  }

  function handleSend() {
    if (!selectedManager) return;
    const text = draft.trim();
    if (!text) return;
    const next = [
      ...dmMessages,
      { id: crypto.randomUUID(), author: name.trim() || "You", text, timestamp: new Date().toISOString() },
    ];
    setDmMessages(next);
    saveDirectMessages(leagueId, selectedManager.entry, next);
    setDraft("");
  }

  if (!selectedManager) {
    return (
      <div className="flex-1 overflow-y-auto p-4" style={{ maxHeight: 380 }}>
        <p className="mb-2 text-xs text-muted">Select a manager to message privately.</p>
        <div className="space-y-1.5">
          {managers.map((manager) => (
            <button
              key={manager.entry}
              type="button"
              onClick={() => selectManager(manager)}
              className="w-full rounded-lg border border-card-border/70 bg-background/40 px-3 py-2 text-left text-sm transition-colors hover:border-accent/50"
            >
              <span className="font-semibold text-foreground">{manager.entryName}</span>{" "}
              <span className="text-muted">({manager.managerName})</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-card-border/50 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setSelectedEntry(null)}
          className="text-xs text-muted transition-colors hover:text-accent"
        >
          &larr; All managers
        </button>
        <span className="text-xs font-semibold text-foreground">{selectedManager.entryName}</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 300 }}>
        <p className="text-[10px] text-muted">
          Private notes to this manager — stored only on your device, not delivered to them.
        </p>
        {dmMessages.length === 0 && <p className="text-xs text-muted">No messages yet.</p>}
        {dmMessages.map((message) => (
          <div key={message.id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">{message.author}</span>
              <span className="text-[10px] text-muted">{formatChatTime(message.timestamp)}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">{message.text}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-card-border p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSend();
            }}
            placeholder={`Message ${selectedManager.entryName}...`}
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
    </>
  );
}

function ChatPanel({ leagueId, managers }: { leagueId: string; managers: LeagueManagerRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"group" | "direct">("group");
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatMessages(leagueId));
  // Frozen the moment the panel mounts — "how many were unread when I
  // arrived" — independent of markChatSeen updating storage once opened, so
  // the catch-up banner still reflects what the user actually missed.
  const [unreadCount] = useState(() => countUnread(leagueId));
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [name, setName] = useState(() => loadChatName());
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
    saveChatName(value);
  }

  function openChat() {
    // A discrete user action, not an effect — marking as seen here (rather
    // than reactively) keeps the frozen unreadCount snapshot above accurate
    // for the catch-up banner.
    markChatSeen(leagueId);
    setExpanded(true);
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

  if (!expanded) {
    const previewMessages = messages.slice(-3);
    return (
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted">League chat</h2>
          {unreadCount > 0 && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="mt-3 space-y-1.5">
          {previewMessages.length === 0 ? (
            <p className="text-xs text-muted">No messages yet — be the first to say something.</p>
          ) : (
            previewMessages.map((message) => (
              <p key={message.id} className="text-xs">
                <span className="font-semibold text-foreground">{message.author}: </span>
                <span className="text-muted">{truncateText(message.text, 90)}</span>
              </p>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={openChat}
          className="mt-3 w-full rounded-lg bg-accent-strong px-3 py-2 text-xs font-semibold text-[#04140b] transition-colors hover:bg-accent"
        >
          Open chat
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-card-border bg-card">
      <div className="flex items-center justify-between border-b border-card-border p-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted">League chat</h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-muted transition-colors hover:text-accent"
        >
          Collapse
        </button>
      </div>

      <div className="flex border-b border-card-border">
        <button
          type="button"
          onClick={() => setActiveTab("group")}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
            activeTab === "group" ? "border-b-2 border-accent text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          Group
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("direct")}
          className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
            activeTab === "direct" ? "border-b-2 border-accent text-accent" : "text-muted hover:text-foreground"
          }`}
        >
          Direct
        </button>
      </div>

      {activeTab === "group" ? (
        <>
          <div className="p-4 pb-0">
            <input
              type="text"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Your name"
              className="w-full rounded-md border border-card-border bg-background/40 px-2 py-1 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 340 }}>
            {unreadCount > 0 && !bannerDismissed && (
              <div className="rounded-lg border border-accent/40 bg-accent/10 p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-accent">
                    Catch up: {unreadCount} new message{unreadCount === 1 ? "" : "s"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setBannerDismissed(true)}
                    aria-label="Dismiss"
                    className="text-muted transition-colors hover:text-foreground"
                  >
                    &times;
                  </button>
                </div>
                <div className="mt-1.5 space-y-1">
                  {messages.slice(-2).map((message) => (
                    <p key={message.id} className="text-xs">
                      <span className="font-semibold text-foreground">{message.author}: </span>
                      <span className="text-muted">{truncateText(message.text, 90)}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {messages.length === 0 && (
              <p className="text-xs text-muted">
                No messages yet — say something to your league, or ask the AI for its take.
              </p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.isAi ? "rounded-lg border border-accent/30 bg-accent/5 p-2.5" : ""}
              >
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
            <p className="mb-1.5 text-[10px] leading-relaxed text-muted">
              Get Claude&apos;s take on your league — who&apos;s flying, who&apos;s struggling, and some
              friendly predictions.
            </p>
            <button
              type="button"
              onClick={handleAskAi}
              disabled={askingAi || managers.length === 0}
              className="mb-3 w-full rounded-lg bg-accent-strong px-3 py-2.5 text-sm font-bold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
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
                className="shrink-0 rounded-lg border border-card-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:text-accent"
              >
                Send
              </button>
            </div>
          </div>
        </>
      ) : (
        <DirectTab leagueId={leagueId} managers={managers} name={name} />
      )}
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
        if (!cancelled) {
          setLeague(data);
          if (data.hasStandings) recordLeagueVisit(leagueId, data.leagueName);
        }
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
