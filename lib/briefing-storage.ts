// Per-device, per-team persistence for the dashboard's daily briefing:
// which squad player statuses were last seen (to detect newly-flagged
// injuries/suspensions) and which calendar day the dashboard was last
// opened (to decide whether to show the "daily briefing is ready" banner).

const SNAPSHOT_PREFIX = "fpl-advisor:briefing-snapshot:";
const LAST_VISIT_PREFIX = "fpl-advisor:last-visit-date:";

export interface BriefingSnapshot {
  statuses: Record<number, string>;
}

export function loadBriefingSnapshot(teamId: string): BriefingSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + teamId);
    if (raw) return JSON.parse(raw) as BriefingSnapshot;
  } catch {
    // localStorage unavailable or corrupt entry — treat as no prior snapshot
  }
  return null;
}

export function saveBriefingSnapshot(teamId: string, snapshot: BriefingSnapshot) {
  try {
    localStorage.setItem(SNAPSHOT_PREFIX + teamId, JSON.stringify(snapshot));
  } catch {
    // localStorage unavailable (private browsing, quota) — snapshot just won't persist
  }
}

export function loadLastVisitDate(teamId: string): string | null {
  try {
    return localStorage.getItem(LAST_VISIT_PREFIX + teamId);
  } catch {
    return null;
  }
}

export function saveLastVisitDate(teamId: string, date: string) {
  try {
    localStorage.setItem(LAST_VISIT_PREFIX + teamId, date);
  } catch {
    // localStorage unavailable — daily banner just won't remember across visits
  }
}
