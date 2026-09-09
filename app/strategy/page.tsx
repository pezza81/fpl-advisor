"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PositionPoints {
  position: string;
  averagePoints: number;
  playerCount: number;
}

interface ValuePick {
  name: string;
  price: number;
  totalPoints: number;
  pointsPerMillion: number;
  position: string;
}

interface PremiumPick {
  name: string;
  price: number;
  totalPoints: number;
  position: string;
}

interface BestScorer {
  gameweek: number;
  name: string;
  points: number;
}

interface TopManagerEntry {
  elementId: number;
  name: string;
  club: string;
  count: number;
  percent: number;
}

interface TopManagersSummary {
  generatedAt: string;
  gameweek: number;
  requestedCount: number;
  sampleSize: number;
  averageSquadValue: number | null;
  averageBank: number | null;
  mostOwned: TopManagerEntry[];
  mostCaptained: TopManagerEntry[];
}

interface StrategyResponse {
  pointsByPosition: PositionPoints[];
  valuePicks: ValuePick[];
  premiumPicks: PremiumPick[];
  bestScorersByGameweek: BestScorer[];
  topManagers: TopManagersSummary | null;
  error?: string;
}

const SECTIONS = [
  { id: "squad-building", label: "Building a squad" },
  { id: "formations", label: "Formations" },
  { id: "strategy-types", label: "Strategy types" },
  { id: "transfers", label: "Transfers" },
  { id: "captaincy", label: "Captaincy" },
  { id: "best-managers", label: "Best managers" },
  { id: "how-to", label: "How-to guides" },
];

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div id={id} className="scroll-mt-20">
      <span className="text-xs font-bold uppercase tracking-widest text-accent">{eyebrow}</span>
      <h2 className="mt-1 text-2xl font-bold text-foreground">{title}</h2>
    </div>
  );
}

const STRATEGY_TYPES = [
  {
    name: "Template",
    tone: "border-emerald-800/60 bg-emerald-950/20",
    title: "text-emerald-400",
    description: "Own most of the same highly-owned players everyone else does.",
    pros: "Safe — you rise and fall with the pack, so a single bad week rarely tanks your rank badly.",
    cons: "Hard to make big rank jumps. If everyone owns Haaland and he blanks, you all suffer together — you gain nothing relative to rivals.",
  },
  {
    name: "Differential",
    tone: "border-rose-800/60 bg-rose-950/20",
    title: "text-rose-400",
    description: "Pick low-ownership players (under ~5%) with high ceiling potential.",
    pros: "A single big differential haul can catapult you past thousands of ranks in one gameweek — the only real way to climb fast from outside the top ranks.",
    cons: "High variance — if your differentials blank while the template captain hauls, you fall behind fast. Needs conviction and a stomach for rank swings.",
  },
  {
    name: "Value",
    tone: "border-sky-800/60 bg-sky-950/20",
    title: "text-sky-400",
    description: "Target players whose price is about to rise, buying in before the crowd does.",
    pros: "Builds team value over the season, which funds later upgrades to premiums without extra transfers — a long-game budget strategy.",
    cons: "Team value gains don't score points by themselves — you still need the underlying picks to actually perform, not just rise in price.",
  },
  {
    name: "Captain-dependent",
    tone: "border-amber-800/60 bg-amber-950/20",
    title: "text-amber-400",
    description: "Build around a nailed-on premium captain every single week, rain or shine.",
    pros: "Simplifies decision-making — one less weekly dilemma — and a truly elite player (peak Haaland/Salah) often justifies it on raw returns alone.",
    cons: "A single bad fixture or rotation risk directly costs you double points that week — total reliance on one player's form and fitness.",
  },
];

const FORMATIONS = [
  {
    name: "3-4-3",
    summary: "3 DEF, 4 MID, 3 FWD",
    note: "The most attacking common setup — maximises midfield and forward returns. Best when your defenders are shakier than your attackers, or fixtures favour goals over clean sheets.",
  },
  {
    name: "3-5-2",
    summary: "3 DEF, 5 MID, 2 FWD",
    note: "Loads the pitch with midfielders (usually the deepest, most productive position) while keeping two strong forwards. A popular balance between attack and squad depth.",
  },
  {
    name: "4-4-2",
    summary: "4 DEF, 4 MID, 2 FWD",
    note: "The classic balanced setup — solid defensive coverage without sacrificing much going forward. A safe default when you're unsure.",
  },
  {
    name: "4-3-3",
    summary: "4 DEF, 3 MID, 3 FWD",
    note: "Strong defensive coverage (good for clean-sheet-heavy defenders) paired with three attacking outlets. Works well when your defence is the stronger part of your squad.",
  },
  {
    name: "4-5-1",
    summary: "4 DEF, 5 MID, 1 FWD",
    note: "Maximum midfield returns with rock-solid defensive cover — but only one forward means less attacking upside if your lone striker blanks.",
  },
];

const HOW_TO_GUIDES = [
  {
    title: "How to make a transfer",
    steps: [
      "Log in at fantasy.premierleague.com and open “Transfers” from the top menu.",
      "Click the player you want to sell — their card highlights and a list of replacement options appears.",
      "Pick your incoming player from the list (or search by name), filtered automatically to what you can afford.",
      "Repeat for any additional transfers.",
      "Check the transfer cost shown at the bottom — it shows 0pts if you're within your free transfers, or -4pts per extra one.",
      "Click “Confirm transfers” before the gameweek deadline. Transfers aren't saved until you confirm this step.",
    ],
  },
  {
    title: "How to change your captain",
    steps: [
      "Go to “Pick Team” from the top menu.",
      "Click on your starting XI player you want as captain.",
      "Select “Captain” from the popup menu (the armband “C” icon appears on their card).",
      "Click your vice-captain choice the same way and select “Vice-Captain”.",
      "Changes save automatically, but only take effect for the gameweek if made before the deadline.",
    ],
  },
  {
    title: "How to change your starting XI and bench order",
    steps: [
      "Go to “Pick Team”.",
      "Drag a bench player onto the pitch to swap them in for the starter you drag off — the formation updates automatically as you go.",
      "To reorder your bench, drag players within the bench row — position 1 is the first auto-substitute if a starter doesn't play.",
      "Make sure your formation stays valid (at least 3 defenders, 2 midfielders, 1 forward, exactly 1 goalkeeper) — invalid formations won't save.",
      "Changes save automatically once your team is valid.",
    ],
  },
  {
    title: "How to activate a chip",
    steps: [
      "Go to “Pick Team”.",
      "Look for the chip icons/menu near the top of the squad view (Wildcard, Free Hit, Bench Boost, Triple Captain).",
      "Click the chip you want to play, then confirm in the popup — read the confirmation carefully, most chips can't be undone once the deadline passes.",
      "For Wildcard/Free Hit, make your transfers as normal afterwards — they'll be free and unlimited while the chip is active.",
      "For Bench Boost/Triple Captain, no further action is needed — it applies automatically to that gameweek's scoring once played.",
    ],
  },
  {
    title: "How to join a mini league",
    steps: [
      "Go to “Leagues & Cups” from the top menu.",
      "Click “Join League or Cup”.",
      "Enter the league code your friend/group shared with you (or search by league name for public leagues).",
      "Confirm to join — you'll appear in the standings from that point onward (points from gameweeks before you joined still count towards the season total).",
      "To create your own league instead, use “Create League or Cup” on the same page and share the generated code.",
    ],
  },
];

export default function StrategyPage() {
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/strategy")
      .then(async (res) => {
        const json = (await res.json()) as StrategyResponse;
        if (!res.ok) throw new Error(json.error ?? "Failed to load strategy data.");
        if (!cancelled) setData(json);
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
  }, []);

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
          <Link href="/guide" className="text-sm text-muted transition-colors hover:text-accent">
            Guide
          </Link>
          <Link href="/trends" className="text-sm text-muted transition-colors hover:text-accent">
            Trends analysis &rarr;
          </Link>
        </div>
      </div>

      <header className="mt-4 flex flex-col gap-1">
        <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Strategy &amp; education
        </span>
        <h1 className="text-3xl font-bold text-foreground">FPL Strategy Guide</h1>
        <p className="text-muted">
          How to build a squad, which formation and strategy fits your risk appetite, when to spend a
          transfer hit, and what the best-ranked managers are actually doing right now.
        </p>
      </header>

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

      {loading && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
          <p>Loading live season data...</p>
        </div>
      )}

      {!loading && error && (
        <div className="mt-16 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* 1. Building a winning squad */}
          <section className="mt-10">
            <SectionHeading id="squad-building" eyebrow="Section 1" title="Building a winning squad" />
            <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted">
              <p>
                With a £100m budget, most successful squads spend roughly{" "}
                <span className="font-semibold text-foreground">£85-90m on their starting XI</span> and
                keep <span className="font-semibold text-foreground">£10-15m for the bench</span> — bench
                players rarely score (see Starting XI vs bench in the{" "}
                <Link href="/guide" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
                  guide
                </Link>
                ), so overspending there is budget sitting idle.
              </p>
              <p>
                Most winning squads carry{" "}
                <span className="font-semibold text-foreground">2-3 premium players (£10m+)</span> — your
                highest-ceiling, most explosive returns, and usually your captaincy pool. Beyond 2-3, extra
                premiums start crowding out the budget you need for a strong rest of the squad.
              </p>
              <p>
                The rest of the budget is best spent finding{" "}
                <span className="font-semibold text-foreground">value in the £5-7m range</span> — players
                delivering points well above what their price suggests. These are what actually separate
                good squads from template ones.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  This season&apos;s best value (£5-7m, by points per £m)
                </h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-card-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-3 py-2 text-left font-semibold">Name</th>
                        <th className="px-3 py-2 text-left font-semibold">Pos</th>
                        <th className="px-3 py-2 text-right font-semibold">Price</th>
                        <th className="px-3 py-2 text-right font-semibold">Pts</th>
                        <th className="px-3 py-2 text-right font-semibold">Pts/£m</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.valuePicks.map((player) => (
                        <tr key={player.name} className="border-b border-card-border/50 last:border-b-0">
                          <td className="px-3 py-2 font-medium text-foreground">{player.name}</td>
                          <td className="px-3 py-2 text-muted">{player.position}</td>
                          <td className="px-3 py-2 text-right text-muted">£{player.price}m</td>
                          <td className="px-3 py-2 text-right text-muted">{player.totalPoints}</td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-400">
                            {player.pointsPerMillion}
                          </td>
                        </tr>
                      ))}
                      {data.valuePicks.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-muted">
                            No qualifying players yet this early in the season.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  This season&apos;s top premiums (£10m+, by total points)
                </h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-card-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-3 py-2 text-left font-semibold">Name</th>
                        <th className="px-3 py-2 text-left font-semibold">Pos</th>
                        <th className="px-3 py-2 text-right font-semibold">Price</th>
                        <th className="px-3 py-2 text-right font-semibold">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.premiumPicks.map((player) => (
                        <tr key={player.name} className="border-b border-card-border/50 last:border-b-0">
                          <td className="px-3 py-2 font-medium text-foreground">{player.name}</td>
                          <td className="px-3 py-2 text-muted">{player.position}</td>
                          <td className="px-3 py-2 text-right text-muted">£{player.price}m</td>
                          <td className="px-3 py-2 text-right font-semibold text-foreground">
                            {player.totalPoints}
                          </td>
                        </tr>
                      ))}
                      {data.premiumPicks.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-muted">
                            No £10m+ players yet this early in the season.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Formation strategy */}
          <section className="mt-10">
            <SectionHeading id="formations" eyebrow="Section 2" title="Formation strategy" />
            <p className="mt-3 text-sm leading-relaxed text-muted">
              More midfielders generally means more attacking returns (midfielders both score and assist
              freely, and pick up clean-sheet points too), but it thins out your defensive and forward
              bench coverage. Pick a formation that matches where your squad&apos;s actual strength is.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {FORMATIONS.map((formation) => (
                <div key={formation.name} className="rounded-lg border border-card-border bg-card px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-accent">{formation.name}</span>
                    <span className="text-xs text-muted">({formation.summary})</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground/90">{formation.note}</p>
                </div>
              ))}
            </div>

            <h3 className="mt-6 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Average points per player this season, by position
            </h3>
            <div className="mt-2 overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-left font-semibold">Position</th>
                    <th className="px-3 py-2 text-right font-semibold">Avg points</th>
                    <th className="px-3 py-2 text-right font-semibold">Players considered</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pointsByPosition.map((row) => (
                    <tr key={row.position} className="border-b border-card-border/50 last:border-b-0">
                      <td className="px-3 py-2 font-medium text-foreground">{row.position}</td>
                      <td className="px-3 py-2 text-right text-foreground">{row.averagePoints}</td>
                      <td className="px-3 py-2 text-right text-muted">{row.playerCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. Strategy types */}
          <section className="mt-10">
            <SectionHeading id="strategy-types" eyebrow="Section 3" title="Strategy types" />
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Most managers land somewhere on a spectrum between these — worth knowing which end you&apos;re
              naturally drawn to, and whether it fits your actual rank goals this season.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {STRATEGY_TYPES.map((strategy) => (
                <div key={strategy.name} className={`rounded-xl border p-5 ${strategy.tone}`}>
                  <h3 className={`text-sm font-bold ${strategy.title}`}>{strategy.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/90">{strategy.description}</p>
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">Pros</p>
                    <p className="mt-1 text-xs leading-relaxed text-foreground/80">{strategy.pros}</p>
                  </div>
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-red-400">Cons</p>
                    <p className="mt-1 text-xs leading-relaxed text-foreground/80">{strategy.cons}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Transfers */}
          <section className="mt-10">
            <SectionHeading id="transfers" eyebrow="Section 4" title="Using transfers effectively" />
            <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted">
              <p>
                <span className="font-semibold text-foreground">Take a -4pt hit</span> only when the
                incoming player is genuinely likely to outscore the cost within a gameweek or two — a
                confirmed injury/suspension replacement, or a clear, urgent upgrade. A hit taken to chase a
                marginal upgrade rarely pays for itself.
              </p>
              <p>
                <span className="font-semibold text-foreground">Roll your transfer</span> (make none) when
                your squad is settled and nothing urgent needs fixing — banking up to 5 free transfers gives
                you the flexibility to make several changes at once later, for free, when you actually need
                to.
              </p>
              <p>
                <span className="font-semibold text-foreground">Wildcard</span> when the situation can&apos;t
                be fixed with 1-2 normal transfers — several injuries at once, a squad that&apos;s fallen
                badly out of form, or a complete fixture-swing rebuild. See the{" "}
                <Link href="/guide#chips" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
                  chips guide
                </Link>{" "}
                for the full breakdown.
              </p>
            </div>
          </section>

          {/* 5. Captain strategy */}
          <section className="mt-10">
            <SectionHeading id="captaincy" eyebrow="Section 5" title="Captain strategy" />
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Captaincy is the single highest-leverage decision you make every week. Consistently picking
              the right captain over a season — rather than an average one — is commonly worth an extra{" "}
              <span className="font-semibold text-foreground">20-30 points across a season</span>, since
              every correct pick doubles a big score instead of a mediocre one.
            </p>

            <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Highest-scoring player each gameweek this season
            </h3>
            <p className="mt-1 text-xs text-muted">
              The theoretical best-possible captain pick each week — captaining the actual top scorer isn&apos;t
              realistic to call in advance, but it shows how much single-gameweek returns can swing.
              Current season only: gameweek-level history isn&apos;t available across our full 3-season
              dataset, only season totals.
            </p>
            <div className="mt-2 overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-left font-semibold">Gameweek</th>
                    <th className="px-3 py-2 text-left font-semibold">Top scorer</th>
                    <th className="px-3 py-2 text-right font-semibold">Points</th>
                    <th className="px-3 py-2 text-right font-semibold">As captain (x2)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bestScorersByGameweek.map((row) => (
                    <tr key={row.gameweek} className="border-b border-card-border/50 last:border-b-0">
                      <td className="px-3 py-2 text-foreground">GW{row.gameweek}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{row.name}</td>
                      <td className="px-3 py-2 text-right text-muted">{row.points}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-400">
                        {row.points * 2}
                      </td>
                    </tr>
                  ))}
                  {data.bestScorersByGameweek.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-muted">
                        No finished gameweeks yet this season.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 6. What the best managers are doing */}
          <section className="mt-10">
            <SectionHeading id="best-managers" eyebrow="Section 6" title="What the best managers are doing" />

            {!data.topManagers && (
              <div className="mt-4 rounded-lg border border-card-border bg-card px-4 py-3 text-sm text-muted">
                This section needs a one-off data pull that hasn&apos;t been run yet —{" "}
                <code className="rounded bg-white/10 px-1 py-0.5 text-xs">npm run fetch:top-managers</code>{" "}
                fetches the top managers from FPL&apos;s Overall league and their current squads.
              </div>
            )}

            {data.topManagers && (
              <>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  Based on a sample of the top {data.topManagers.sampleSize.toLocaleString()} managers in
                  FPL&apos;s official Overall league, as of gameweek {data.topManagers.gameweek}.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-card-border/70 bg-background/40 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Sample size
                    </p>
                    <p className="mt-0.5 text-lg font-bold text-foreground">
                      {data.topManagers.sampleSize.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border border-card-border/70 bg-background/40 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Avg squad value
                    </p>
                    <p className="mt-0.5 text-lg font-bold text-foreground">
                      £{data.topManagers.averageSquadValue ?? "—"}m
                    </p>
                  </div>
                  <div className="rounded-lg border border-card-border/70 bg-background/40 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Avg bank</p>
                    <p className="mt-0.5 text-lg font-bold text-foreground">
                      £{data.topManagers.averageBank ?? "—"}m
                    </p>
                  </div>
                  <div className="rounded-lg border border-card-border/70 bg-background/40 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Top captain</p>
                    <p className="mt-0.5 text-lg font-bold text-foreground">
                      {data.topManagers.mostCaptained[0]?.name ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Most-owned players among top managers
                    </h3>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {data.topManagers.mostOwned.map((player) => (
                        <li
                          key={player.elementId}
                          className="flex items-center justify-between rounded-lg border border-card-border/70 bg-background/40 px-3 py-2 text-sm"
                        >
                          <span className="text-foreground">
                            {player.name} <span className="text-muted">({player.club})</span>
                          </span>
                          <span className="font-semibold text-emerald-400">{player.percent}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Most-captained players among top managers
                    </h3>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {data.topManagers.mostCaptained.map((player) => (
                        <li
                          key={player.elementId}
                          className="flex items-center justify-between rounded-lg border border-card-border/70 bg-background/40 px-3 py-2 text-sm"
                        >
                          <span className="text-foreground">
                            {player.name} <span className="text-muted">({player.club})</span>
                          </span>
                          <span className="font-semibold text-amber-400">{player.percent}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* 7. Step-by-step how-to guides */}
          <section className="mt-10 mb-4">
            <SectionHeading id="how-to" eyebrow="Section 7" title="Step-by-step guides" />
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Quick instructions for the common actions on the official FPL site.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {HOW_TO_GUIDES.map((guide) => (
                <div key={guide.title} className="rounded-xl border border-card-border bg-card p-5">
                  <h3 className="text-sm font-bold text-foreground">{guide.title}</h3>
                  <ol className="mt-3 flex flex-col gap-2">
                    {guide.steps.map((step, index) => (
                      <li key={index} className="flex gap-2 text-xs leading-relaxed text-muted">
                        <span className="shrink-0 font-bold text-accent">{index + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
