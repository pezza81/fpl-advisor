// All client-only, localStorage-backed — there's no backend for league chat,
// so "shared" messages only exist within one browser. Centralized here since
// both the league page and the dashboard's league cards need to read/write
// the same data (chat log, last-seen timestamps).

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  timestamp: string;
  isAi?: boolean;
}

const CHAT_NAME_KEY = "fpl-advisor:chat-name";

function chatKey(leagueId: string): string {
  return `fpl-advisor:league-chat:${leagueId}`;
}

function lastSeenKey(leagueId: string): string {
  return `fpl-advisor:league-chat-lastseen:${leagueId}`;
}

function dmKey(leagueId: string, managerEntry: string | number): string {
  return `fpl-advisor:league-dm:${leagueId}:${managerEntry}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private browsing, quota) — just won't persist
  }
}

export function loadChatMessages(leagueId: string): ChatMessage[] {
  return readJson(chatKey(leagueId), []);
}

export function saveChatMessages(leagueId: string, messages: ChatMessage[]): void {
  writeJson(chatKey(leagueId), messages);
}

export function loadLastSeen(leagueId: string): string | null {
  try {
    return localStorage.getItem(lastSeenKey(leagueId));
  } catch {
    return null;
  }
}

export function markChatSeen(leagueId: string): void {
  try {
    localStorage.setItem(lastSeenKey(leagueId), new Date().toISOString());
  } catch {
    // ignore
  }
}

// Messages strictly after the stored last-seen time — 0 if never visited
// before isn't quite right (everything would count as "unread" on a first
// ever visit), so a league with no recorded last-seen counts as fully caught up.
export function countUnread(leagueId: string, messages?: ChatMessage[]): number {
  const lastSeen = loadLastSeen(leagueId);
  if (!lastSeen) return 0;
  const log = messages ?? loadChatMessages(leagueId);
  const cutoff = new Date(lastSeen).getTime();
  return log.filter((message) => new Date(message.timestamp).getTime() > cutoff).length;
}

export function loadDirectMessages(leagueId: string, managerEntry: string | number): ChatMessage[] {
  return readJson(dmKey(leagueId, managerEntry), []);
}

export function saveDirectMessages(
  leagueId: string,
  managerEntry: string | number,
  messages: ChatMessage[],
): void {
  writeJson(dmKey(leagueId, managerEntry), messages);
}

export function loadChatName(): string {
  try {
    return localStorage.getItem(CHAT_NAME_KEY) ?? "You";
  } catch {
    return "You";
  }
}

export function saveChatName(name: string): void {
  try {
    localStorage.setItem(CHAT_NAME_KEY, name);
  } catch {
    // ignore
  }
}
