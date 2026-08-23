import { extractActionReason, type AdviceLike } from "@/lib/advice-reasons";

export function ActionChecklist({
  actions,
  advice,
  squadNames,
  checkedActions,
  onToggle,
}: {
  actions: string[];
  advice: AdviceLike;
  squadNames: string[];
  checkedActions: Set<number>;
  onToggle: (index: number) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <section className="mt-6 rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Your gameweek actions</h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {actions.map((action, index) => {
          const checked = checkedActions.has(index);
          const reason = extractActionReason(action, advice, squadNames);
          return (
            <li key={index}>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(index)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent-strong"
                />
                <span className="min-w-0">
                  <span className={checked ? "text-muted line-through" : "text-foreground"}>{action}</span>
                  {reason && <p className="mt-0.5 text-xs text-muted">{reason}</p>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
