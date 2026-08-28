import Link from "next/link";
import { CHIP_EXPLANATIONS } from "@/lib/chips";

interface ScoringRow {
  action: string;
  gkp: string;
  def: string;
  mid: string;
  fwd: string;
}

const SCORING_ROWS: ScoringRow[] = [
  { action: "Playing under 60 minutes", gkp: "1pt", def: "1pt", mid: "1pt", fwd: "1pt" },
  { action: "Playing 60+ minutes", gkp: "2pts", def: "2pts", mid: "2pts", fwd: "2pts" },
  { action: "Goal scored", gkp: "6pts", def: "6pts", mid: "5pts", fwd: "4pts" },
  { action: "Assist", gkp: "3pts", def: "3pts", mid: "3pts", fwd: "3pts" },
  { action: "Clean sheet (60+ mins)", gkp: "6pts", def: "6pts", mid: "1pt", fwd: "0pts" },
  { action: "Every 3 saves made", gkp: "1pt", def: "—", mid: "—", fwd: "—" },
  { action: "Penalty save", gkp: "5pts", def: "—", mid: "—", fwd: "—" },
  { action: "Every 2 goals conceded", gkp: "-1pt", def: "-1pt", mid: "—", fwd: "—" },
  { action: "Penalty miss", gkp: "-2pts", def: "-2pts", mid: "-2pts", fwd: "-2pts" },
  { action: "Yellow card", gkp: "-1pt", def: "-1pt", mid: "-1pt", fwd: "-1pt" },
  { action: "Red card", gkp: "-3pts", def: "-3pts", mid: "-3pts", fwd: "-3pts" },
  { action: "Own goal", gkp: "-2pts", def: "-2pts", mid: "-2pts", fwd: "-2pts" },
  { action: "Bonus points (best performers)", gkp: "1-3pts", def: "1-3pts", mid: "1-3pts", fwd: "1-3pts" },
];

const SECTIONS = [
  { id: "scoring", label: "How points work" },
  { id: "chips", label: "Chips explained" },
  { id: "transfers", label: "Transfers" },
  { id: "captain", label: "Captain & vice-captain" },
  { id: "squad", label: "Starting XI vs bench" },
  { id: "chip-strategy", label: "When to use chips" },
];

const CHIP_TONE_CLASSES: Record<string, string> = {
  wildcard: "border-emerald-800/60 bg-emerald-950/20",
  freehit: "border-sky-800/60 bg-sky-950/20",
  bboost: "border-amber-800/60 bg-amber-950/20",
  "3xc": "border-rose-800/60 bg-rose-950/20",
};

const CHIP_TITLE_CLASSES: Record<string, string> = {
  wildcard: "text-emerald-400",
  freehit: "text-sky-400",
  bboost: "text-amber-400",
  "3xc": "text-rose-400",
};

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div id={id} className="scroll-mt-20">
      <span className="text-xs font-bold uppercase tracking-widest text-accent">{eyebrow}</span>
      <h2 className="mt-1 text-2xl font-bold text-foreground">{title}</h2>
    </div>
  );
}

function ExampleBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-accent">Example</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{children}</p>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
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
          <Link href="/league/demo" className="text-sm text-muted transition-colors hover:text-accent">
            League
          </Link>
          <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
            Trends analysis &rarr;
          </Link>
        </div>
      </div>

      <header className="mt-4 flex flex-col gap-1">
        <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          New manager guide
        </span>
        <h1 className="text-3xl font-bold text-foreground">How Fantasy Premier League works</h1>
        <p className="text-muted">
          Everything you need to know before your first gameweek — how scoring works, what each chip
          does, how transfers and captaincy work, and when to actually use each chip.
        </p>
      </header>

      {/* Table of contents */}
      <nav className="mt-6 flex flex-wrap gap-2 rounded-xl border border-card-border bg-card p-3">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-white/5 hover:text-accent"
          >
            {section.label}
          </a>
        ))}
      </nav>

      {/* 1. How points work */}
      <section className="mt-10">
        <SectionHeading id="scoring" eyebrow="Section 1" title="How points work, by position" />
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Every player earns points from the same set of actions, but a handful of them pay out
          differently depending on position — a defender scoring a goal is worth more than a forward
          doing the same, since it&apos;s a rarer event for their position.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-semibold">Action</th>
                <th className="px-3 py-2 text-right font-semibold">GKP</th>
                <th className="px-3 py-2 text-right font-semibold">DEF</th>
                <th className="px-3 py-2 text-right font-semibold">MID</th>
                <th className="px-3 py-2 text-right font-semibold">FWD</th>
              </tr>
            </thead>
            <tbody>
              {SCORING_ROWS.map((row) => (
                <tr key={row.action} className="border-b border-card-border/50 last:border-b-0">
                  <td className="px-3 py-2.5 text-foreground">{row.action}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{row.gkp}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{row.def}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{row.mid}</td>
                  <td className="px-3 py-2.5 text-right text-muted">{row.fwd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ExampleBox>
          A defender who plays the full match, keeps a clean sheet, and scores a goal earns: 2pts
          (appearance) + 6pts (clean sheet) + 6pts (goal) = 14pts, before bonus points are even added.
        </ExampleBox>
      </section>

      {/* 2. Chips explained */}
      <section className="mt-10">
        <SectionHeading id="chips" eyebrow="Section 2" title="Chips explained" />
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Chips are one-off boosts you can play to bend the normal rules for a single gameweek. Each
          one can only be used a limited number of times a season, and only one chip can be active in
          any given gameweek.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CHIP_EXPLANATIONS.map((chip) => (
            <div
              key={chip.name}
              className={`rounded-xl border p-5 ${CHIP_TONE_CLASSES[chip.name] ?? "border-card-border bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className={`text-sm font-bold ${CHIP_TITLE_CLASSES[chip.name] ?? "text-foreground"}`}>
                  {chip.label}
                </h3>
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground/80">
                  {chip.timesPerSeason.split(" — ")[0]}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-foreground/90">{chip.description}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">{chip.whenToUse}</p>
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Example</p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">{chip.example}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Transfers explained */}
      <section className="mt-10">
        <SectionHeading id="transfers" eyebrow="Section 3" title="Transfers explained" />
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted">
          <p>
            You get <span className="font-semibold text-foreground">1 free transfer every gameweek</span> —
            swapping one player for another with no points cost.
          </p>
          <p>
            Don&apos;t use it, and it <span className="font-semibold text-foreground">rolls over</span> to
            the following gameweek, banking up to a maximum of{" "}
            <span className="font-semibold text-foreground">5 free transfers</span> saved up at once.
          </p>
          <p>
            Make more transfers in a gameweek than you have saved up, and each extra one costs{" "}
            <span className="font-semibold text-red-400">-4 points</span>, deducted straight from that
            gameweek&apos;s score.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-semibold">Gameweek</th>
                <th className="px-3 py-2 text-left font-semibold">You do</th>
                <th className="px-3 py-2 text-right font-semibold">Free transfers available</th>
                <th className="px-3 py-2 text-right font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-card-border/50">
                <td className="px-3 py-2.5 text-foreground">GW5</td>
                <td className="px-3 py-2.5 text-muted">Make no transfers</td>
                <td className="px-3 py-2.5 text-right text-muted">1</td>
                <td className="px-3 py-2.5 text-right text-emerald-400">0pts</td>
              </tr>
              <tr className="border-b border-card-border/50">
                <td className="px-3 py-2.5 text-foreground">GW6</td>
                <td className="px-3 py-2.5 text-muted">Rolled over — now have 2, make 2 transfers</td>
                <td className="px-3 py-2.5 text-right text-muted">2</td>
                <td className="px-3 py-2.5 text-right text-emerald-400">0pts</td>
              </tr>
              <tr className="border-b border-card-border/50 last:border-b-0">
                <td className="px-3 py-2.5 text-foreground">GW7</td>
                <td className="px-3 py-2.5 text-muted">Have 1 free, but make 3 transfers</td>
                <td className="px-3 py-2.5 text-right text-muted">1</td>
                <td className="px-3 py-2.5 text-right text-red-400">-8pts (2 extra)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Playing Wildcard or Free Hit makes every transfer that gameweek free and unlimited, and
          doesn&apos;t touch your banked free transfers at all.
        </p>
      </section>

      {/* 4. Captain and vice-captain */}
      <section className="mt-10">
        <SectionHeading id="captain" eyebrow="Section 4" title="Captain and vice-captain" />
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted">
          <p>
            Before every deadline, you pick one player as{" "}
            <span className="font-semibold text-foreground">captain</span> — whatever points they score
            that gameweek are{" "}
            <span className="font-semibold text-foreground">doubled (2x)</span>. It&apos;s usually your
            most reliable, highest-ceiling player, since a big haul is worth double.
          </p>
          <p>
            Your <span className="font-semibold text-foreground">vice-captain</span> pick is insurance:
            if your captain doesn&apos;t play at all that gameweek (injury, suspension, rotation — 0
            minutes), the armband and the 2x bonus{" "}
            <span className="font-semibold text-foreground">automatically passes to your vice-captain</span>{" "}
            instead. If your captain plays even a single minute, the armband stays with them regardless
            of how they perform.
          </p>
          <p className="text-amber-300">
            If both your captain and vice-captain fail to play, nobody gets the double — worth picking
            two players from different clubs playing at different times as a safety net.
          </p>
        </div>
      </section>

      {/* 5. Starting XI vs bench */}
      <section className="mt-10">
        <SectionHeading id="squad" eyebrow="Section 5" title="Starting XI vs bench" />
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted">
          <p>
            Your 15-man squad splits into a{" "}
            <span className="font-semibold text-foreground">starting XI</span> (whose points count
            towards your total) and a{" "}
            <span className="font-semibold text-foreground">4-man bench</span> (one goalkeeper, three
            outfield players) that normally scores nothing at all.
          </p>
          <p>
            After each gameweek, FPL runs{" "}
            <span className="font-semibold text-foreground">automatic substitutions</span>: if a starter
            doesn&apos;t play a single minute, they&apos;re swapped out for the highest-priority bench
            player (in your chosen bench order) who did play — and whose position keeps your team to a
            valid formation.
          </p>
          <p>
            The key thing to understand: a starter who plays but scores badly (even negative points) is{" "}
            <span className="font-semibold text-foreground">never</span> substituted out — only a
            genuine 0-minute non-appearance triggers an auto-sub. Your bench order matters, so put your
            best-value bench player first.
          </p>
        </div>
      </section>

      {/* 6. When to use chips */}
      <section className="mt-10 mb-4">
        <SectionHeading id="chip-strategy" eyebrow="Section 6" title="When to use chips — quick reference" />
        <p className="mt-3 text-sm leading-relaxed text-muted">
          A simple cheat sheet for deciding which chip fits which moment:
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg border border-rose-800/60 bg-rose-950/20 px-4 py-3">
            <p className="text-sm">
              <span className="font-bold text-rose-400">Triple Captain</span>{" "}
              <span className="text-foreground/90">
                — on a premium player with two great fixtures in a double gameweek. Classic example: Haaland
                with a double gameweek against two weak defences.
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-4 py-3">
            <p className="text-sm">
              <span className="font-bold text-amber-400">Bench Boost</span>{" "}
              <span className="text-foreground/90">
                — when your entire 15-man squad is fit and nailed-on to start, ideally in a double
                gameweek so the bench contributes twice over.
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-sky-800/60 bg-sky-950/20 px-4 py-3">
            <p className="text-sm">
              <span className="font-bold text-sky-400">Free Hit</span>{" "}
              <span className="text-foreground/90">
                — on a blank gameweek, when several of your players have no fixture at all and you need
                a one-week-only fix.
              </span>
            </p>
          </div>
          <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/20 px-4 py-3">
            <p className="text-sm">
              <span className="font-bold text-emerald-400">Wildcard</span>{" "}
              <span className="text-foreground/90">
                — when your squad needs a genuine full reset: an injury crisis, a terrible run of
                fixtures, or a complete rebuild around new price/form data.
              </span>
            </p>
          </div>
        </div>
      </section>

      <div className="mt-10 flex justify-center">
        <Link
          href="/"
          className="rounded-lg bg-accent-strong px-8 py-3 font-semibold text-[#04140b] transition-colors hover:bg-accent"
        >
          Get started with your team &rarr;
        </Link>
      </div>
    </div>
  );
}
