// Remembers the manager's own FPL team id across visits so the landing page
// can send returning users straight to their team, skipping the form.
const TEAM_ID_KEY = "fpl-advisor:team-id";

export function loadSavedTeamId(): string | null {
  try {
    return localStorage.getItem(TEAM_ID_KEY);
  } catch {
    return null;
  }
}

export function saveTeamId(teamId: string): void {
  try {
    localStorage.setItem(TEAM_ID_KEY, teamId);
  } catch {
    // localStorage unavailable — the remember-me redirect just won't persist
  }
}

export function clearSavedTeamId(): void {
  try {
    localStorage.removeItem(TEAM_ID_KEY);
  } catch {
    // ignore
  }
}
