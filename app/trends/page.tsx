"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface TrendsMeta {
  generatedAt: string;
  seasons: number[];
  earlyRounds: number[];
  lateRounds: number[];
  totalPlayersConsidered: number;
  playersInDigest: number;
  error?: string;
}

interface TrendHighlight {
  player: string;
  note: string;
}

interface TrendSection {
  headline: string;
  highlights: TrendHighlight[];
  detail: string;
}

interface TrendsResult {
  captaincy: TrendSection;
  seasonalForm: TrendSection;
  pricePerformance: TrendSection;
  earlyLate: TrendSection;
  error?: string;
}

export default function TrendsPage() {
  const [meta, setMeta] = useState<TrendsMeta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [result, setResult] = useState<TrendsResult | null>(null);
  const [resultError, setResultError] = useState("");
  const [loadingResult, setLoadingResult] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/trends")
      .then(async (res) => {
        const data = (await res.json()) as TrendsMeta;
        if (!res.ok) throw new Error(data.error ?? "Failed to load dataset info.");
        if (!cancelled) setMeta(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setMetaError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAnalyze() {
    setLoadingResult(true);
    setResultError("");
    setResult(null);

    try {
      const res = await fetch("/api/trends", { method: "POST" });
      const data = (await res.json()) as TrendsResult;
      if (!res.ok) throw new Error(data.error ?? "Failed to generate trend analysis.");
      setResult(data);
    } catch (err) {
      setResultError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoadingResult(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link href="/" className="text-sm text-muted transition-colors hover:text-accent">
        &larr; Back
      </Link>

      <header className="mt-4 flex flex-col gap-1">
        <span className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Historical trends
        </span>
        <h1 className="text-3xl font-bold text-foreground">Trends Analysis</h1>
        <p className="text-muted">
          Three seasons of real Premier League data, distilled by Claude into patterns
          you can use for transfer and captaincy calls.
        </p>
      </header>

      {loadingMeta && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-card-border border-t-accent" />
          <p>Loading dataset...</p>
        </div>
      )}

      {!loadingMeta && metaError && (
        <div className="mt-10 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-red-300">
          {metaError}
        </div>
      )}

      {!loadingMeta && meta && (
        <>
          <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Seasons" value={meta.seasons.join(", ")} />
            <StatTile label="Players analyzed" value={String(meta.playersInDigest)} />
            <StatTile
              label="Early window"
              value={`Rounds ${meta.earlyRounds[0]}–${meta.earlyRounds.at(-1)}`}
            />
            <StatTile
              label="Late window"
              value={`Rounds ${meta.lateRounds[0]}–${meta.lateRounds.at(-1)}`}
            />
          </section>
          <p className="mt-3 text-xs text-muted">
            Sourced from API-Football &middot; data pulled{" "}
            {new Date(meta.generatedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>

          <div className="mt-10 flex justify-center">
            <button
              onClick={handleAnalyze}
              disabled={loadingResult}
              className="rounded-lg bg-accent-strong px-8 py-3 font-semibold text-[#04140b] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingResult ? "Crunching three seasons..." : "Analyze Trends"}
            </button>
          </div>

          {resultError && (
            <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/30 px-5 py-4 text-center text-red-300">
              {resultError}
            </div>
          )}

          {result && (
            <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
              <TrendCard title="Captaincy trends" section={result.captaincy} tone="green" />
              <TrendCard title="Seasonal form patterns" section={result.seasonalForm} tone="amber" />
              <TrendCard title="Price vs performance" section={result.pricePerformance} tone="blue" />
              <TrendCard title="Early vs late season" section={result.earlyLate} tone="violet" />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-semibold text-foreground">{value}</p>
    </div>
  );
}

const TONE_STYLES = {
  green: {
    card: "border-emerald-800/60 bg-emerald-950/30",
    label: "text-emerald-400",
    accentBar: "bg-emerald-500",
  },
  amber: {
    card: "border-amber-800/60 bg-amber-950/30",
    label: "text-amber-400",
    accentBar: "bg-amber-500",
  },
  blue: {
    card: "border-sky-800/60 bg-sky-950/30",
    label: "text-sky-400",
    accentBar: "bg-sky-500",
  },
  violet: {
    card: "border-violet-800/60 bg-violet-950/30",
    label: "text-violet-400",
    accentBar: "bg-violet-500",
  },
} as const;

function TrendCard({
  title,
  section,
  tone,
}: {
  title: string;
  section: TrendSection;
  tone: keyof typeof TONE_STYLES;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <div className={`overflow-hidden rounded-xl border ${styles.card}`}>
      <div className={`h-1 w-full ${styles.accentBar}`} />
      <div className="p-5">
        <h3 className={`text-xs font-bold uppercase tracking-widest ${styles.label}`}>{title}</h3>

        {/* The single most important, skimmable takeaway — shown first and largest. */}
        <p className="mt-2 text-lg font-semibold leading-snug text-foreground">
          {section.headline}
        </p>

        {section.highlights.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1.5 border-t border-white/10 pt-4">
            {section.highlights.map((highlight, index) => (
              <li key={index} className="text-sm leading-snug">
                <span className="font-bold text-accent">{highlight.player}</span>{" "}
                <span className="text-foreground/85">{highlight.note}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs leading-relaxed text-muted">{section.detail}</p>
      </div>
    </div>
  );
}
