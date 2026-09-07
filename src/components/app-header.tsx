import Link from "next/link";
import type { HealthStatus } from "@/lib/types";
import { EngineBadge } from "./engine-badge";

type Props = {
  health?: HealthStatus | null;
};

export function AppHeader({ health }: Props) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
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
      <div className="flex items-center gap-3">
        <Link
          href="/library"
          className="rounded-full border border-[var(--line)] px-4 py-2 text-xs uppercase tracking-[0.18em] text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          Library
        </Link>
        <EngineBadge health={health ?? null} />
      </div>
    </header>
  );
}
