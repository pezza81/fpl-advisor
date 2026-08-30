// Per-team FPL session token, kept only in this browser. This is a session
// cookie value equivalent to being logged into the user's real FPL account —
// treat it as sensitive. It is never encrypted (a client-side "encryption"
// whose key must also live in this same browser wouldn't add real
// protection — see the /team page's connect flow for the full explanation
// shown to users), and the user's password is never stored anywhere at all,
// only used once by the server to obtain this token.

const SESSION_KEY_PREFIX = "fpl-advisor:fpl-session:";

export function saveFplSession(teamId: string, sessionCookie: string) {
  try {
    localStorage.setItem(SESSION_KEY_PREFIX + teamId, sessionCookie);
  } catch {
    // localStorage unavailable (private browsing, quota) — connection just won't persist across reloads
  }
}

export function loadFplSession(teamId: string): string | null {
  try {
    return localStorage.getItem(SESSION_KEY_PREFIX + teamId);
  } catch {
    return null;
  }
}

export function clearFplSession(teamId: string) {
  try {
    localStorage.removeItem(SESSION_KEY_PREFIX + teamId);
  } catch {
    // ignore
  }
}
