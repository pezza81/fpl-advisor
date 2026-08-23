const TONE_CLASSES = {
  green: "border-emerald-800/60 bg-emerald-950/30 text-emerald-100",
  red: "border-rose-800/60 bg-rose-950/30 text-rose-100",
  blue: "border-sky-800/60 bg-sky-950/30 text-sky-100",
} as const;

const TITLE_CLASSES = {
  green: "text-emerald-400",
  red: "text-rose-400",
  blue: "text-sky-400",
} as const;

export function AdviceCard({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone: "green" | "red" | "blue";
}) {
  return (
    <div className={`rounded-xl border p-5 ${TONE_CLASSES[tone]}`}>
      <h3 className={`text-xs font-bold uppercase tracking-widest ${TITLE_CLASSES[tone]}`}>{title}</h3>
      <p className="mt-3 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
