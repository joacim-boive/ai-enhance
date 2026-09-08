"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { HealthStatus } from "@/lib/types";
import { EngineBadge } from "./engine-badge";
import { GpuFleetBanner } from "./gpu-fleet-banner";

type Props = {
  health?: HealthStatus | null;
  activeJobCount?: number;
  totalJobCount?: number;
  isQueueOpen?: boolean;
  onToggleQueue?: () => void;
};

export function AppHeader({
  health: healthProp,
  activeJobCount = 0,
  totalJobCount = 0,
  isQueueOpen = false,
  onToggleQueue,
}: Props) {
  const [fetched, setFetched] = useState<HealthStatus | null>(null);
  const selfFetch = healthProp === undefined;
  const pathname = usePathname();
  const libraryActive = pathname === "/library";

  useEffect(() => {
    if (!selfFetch) {
      return;
    }
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const data = (await response.json()) as HealthStatus;
        if (!cancelled) {
          setFetched(data);
        }
      } catch {
        // Keep checking until a later poll succeeds.
      }
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selfFetch]);

  const health = selfFetch ? fetched : (healthProp ?? null);

  return (
    <>
      <header className="mb-8 flex flex-col gap-4 overflow-x-hidden">
        <div className="min-w-0">
          <Link href="/" className="group flex items-baseline gap-3">
            <span className="font-serif text-3xl tracking-tight gold-text md:text-4xl">
              Lumen
            </span>
            <span className="text-sm uppercase tracking-[0.28em] text-[var(--muted)]">
              Enhance
            </span>
          </Link>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
            Studio-grade upscaling and frame interpolation. Live feedback, with a
            graceful fallback if the GPU is cold.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <nav className="flex flex-wrap items-center gap-2">
            {onToggleQueue ? (
              <button
                type="button"
                onClick={onToggleQueue}
                className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition cursor-pointer ${
                  isQueueOpen
                    ? "border-[var(--gold)] text-[var(--gold)] bg-[rgba(226,181,122,0.08)]"
                    : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                }`}
              >
                {activeJobCount > 0 ? (
                  <span className="h-2 w-2 rounded-full bg-[var(--teal)] animate-pulse" />
                ) : null}
                <span>Queue</span>
                {activeJobCount > 0 ? (
                  <span className="rounded-full bg-[rgba(65,182,157,0.2)] px-1.5 py-0.2 text-[10px] text-[var(--teal)] font-mono">
                    {activeJobCount}
                  </span>
                ) : totalJobCount > 0 ? (
                  <span className="text-[10px] text-[var(--muted)] font-mono">
                    ({totalJobCount})
                  </span>
                ) : null}
              </button>
            ) : (
              <Link
                href="/?view=queue"
                className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
              >
                Queue
              </Link>
            )}
            <Link
              href="/library"
              className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                libraryActive
                  ? "border-[var(--gold)] bg-[rgba(226,181,122,0.08)] text-[var(--gold)]"
                  : "border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
              }`}
            >
              Library
            </Link>
          </nav>
          <EngineBadge health={health} />
        </div>
      </header>
      {health?.gpu ? <GpuFleetBanner gpu={health.gpu} /> : null}
    </>
  );
}
