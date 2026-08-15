"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function Home() {
  const router = useRouter();
  const [teamId, setTeamId] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = teamId.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError("Enter a valid numeric FPL team ID.");
      return;
    }
    setError("");
    router.push(`/team/${trimmed}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <main className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-6 flex items-center gap-2 rounded-full border border-card-border bg-card px-4 py-1.5 text-xs font-medium tracking-wide text-accent uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Powered by Claude
        </div>

        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          FPL <span className="text-accent">Advisor</span>
        </h1>

        <p className="mt-4 text-lg text-muted">
          Plain English advice for your FPL team
        </p>

        <form onSubmit={handleSubmit} className="mt-10 w-full">
          <label htmlFor="teamId" className="sr-only">
            FPL Team ID
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="teamId"
              type="text"
              inputMode="numeric"
              placeholder="Enter your FPL team ID"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              className="w-full rounded-lg border border-card-border bg-card px-4 py-3 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-accent-strong px-6 py-3 font-semibold text-[#04140b] transition-colors hover:bg-accent"
            >
              Get advice
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </form>

        <p className="mt-6 text-sm text-muted">
          Find your team ID in the URL of your FPL &ldquo;Points&rdquo; page —{" "}
          <span className="text-foreground">
            fantasy.premierleague.com/entry/
          </span>
          <span className="text-accent">1234567</span>
          <span className="text-foreground">/event/1</span>
        </p>

        <div className="mt-8 flex w-full items-center gap-3 text-xs uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-card-border" />
          or
          <span className="h-px flex-1 bg-card-border" />
        </div>

        <Link
          href="/team/demo"
          className="mt-8 rounded-lg border border-card-border bg-card px-6 py-3 font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
        >
          Try the demo squad
        </Link>
        <p className="mt-3 text-xs text-muted">
          No team ID needed — see the full app with a sample squad. Handy
          while the season is between gameweeks.
        </p>

        <Link
          href="/trends"
          className="mt-4 text-sm text-muted underline decoration-card-border underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
        >
          See 3-season trends analysis &rarr;
        </Link>
      </main>
    </div>
  );
}
