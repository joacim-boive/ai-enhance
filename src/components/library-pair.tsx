"use client";

import { useState, type FormEvent } from "react";
import { normalizePairCode } from "@/lib/keys";

type Props = {
  hasClips: boolean;
  onClaimed: () => Promise<void>;
};

export function LibraryPair({ hasClips, onClaimed }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [minting, setMinting] = useState(false);
  const [claim, setClaim] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mintCode(): Promise<void> {
    setMinting(true);
    setError(null);
    try {
      const response = await fetch("/api/session/pair", { method: "POST" });
      const data = (await response.json()) as { code?: string; expiresAt?: number; error?: string };
      if (!response.ok || !data.code) {
        throw new Error(data.error || "Could not mint a studio code.");
      }
      setCode(data.code);
      setExpiresAt(data.expiresAt ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not mint a studio code.");
    } finally {
      setMinting(false);
    }
  }

  async function submitClaim(event: FormEvent): Promise<void> {
    event.preventDefault();
    const next = normalizePairCode(claim);
    if (next.length !== 6) {
      setError("Enter the 6-character code from the other device.");
      return;
    }
    setClaiming(true);
    setError(null);
    try {
      const response = await fetch("/api/session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: next }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "That studio code is invalid or has expired.");
      }
      setClaim("");
      await onClaimed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that library.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-black/20 px-5 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">This browser’s library</p>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {hasClips
          ? "Clips stay on this device until you open them elsewhere with a studio code."
          : "Uploads live in this browser. If you already dropped files on a computer, enter the studio code from that Library."}
      </p>
      {hasClips ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void mintCode()}
            disabled={minting}
            className="rounded-full border border-[var(--line-strong)] px-4 py-2 text-xs uppercase tracking-[0.16em] text-[var(--ink)] disabled:opacity-40"
          >
            {minting ? "Minting…" : code ? "Mint a new code" : "Open on another device"}
          </button>
          {code ? (
            <p className="font-mono text-xl tracking-[0.28em] text-[var(--gold)]">
              {code}
              {expiresAt ? (
                <span className="ml-3 text-[11px] tracking-[0.14em] text-[var(--muted)]">
                  10 min
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : (
        <form onSubmit={(event) => void submitClaim(event)} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={claim}
            onChange={(event) => setClaim(normalizePairCode(event.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            placeholder="Studio code"
            className="min-w-0 flex-1 rounded-full border border-[var(--line-strong)] bg-black/30 px-4 py-3 font-mono text-sm uppercase tracking-[0.2em] text-[var(--ink)] outline-none placeholder:tracking-[0.08em] placeholder:normal-case placeholder:text-[var(--muted)] focus:border-[var(--gold)]"
          />
          <button
            type="submit"
            disabled={claiming || claim.length !== 6}
            className="rounded-full border border-[var(--line-strong)] px-5 py-3 text-xs uppercase tracking-[0.16em] text-[var(--ink)] disabled:opacity-40"
          >
            {claiming ? "Opening…" : "Open library"}
          </button>
        </form>
      )}
      {error ? <p className="mt-3 text-sm text-[var(--err)]">{error}</p> : null}
    </div>
  );
}
