const STATUS_LABELS: Record<string, string> = {
  a: "Available",
  d: "Doubtful",
  i: "Injured",
  s: "Suspended",
  u: "Unavailable",
  n: "Not eligible",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusBadgeClasses(status: string): string {
  if (status === "a") return "bg-accent/15 text-accent";
  if (status === "d") return "bg-amber-500/15 text-amber-400";
  return "bg-red-500/15 text-red-400";
}
