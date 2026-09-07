import type { HealthStatus } from "@/lib/types";

type Props = {
  health: HealthStatus | null;
};

export function EngineBadge({ health }: Props) {
  if (!health) {
    return (
      <div className="rounded-full border border-[var(--line)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
        Checking engines
      </div>
    );
  }
  const gpu = health.gpu;
  const gpuTone = gpu.configured
    ? gpu.ready
      ? "text-[var(--teal)]"
      : "text-[var(--gold)]"
    : "text-[var(--muted)]";
  const gpuTitle = gpu.message;
  const gpuLabel = !gpu.configured
    ? "GPU unset"
    : gpu.ready
      ? "GPU ready"
      : "GPU cold";
  const cpuLabel = health.ffmpeg.ok ? "CPU ready" : "CPU missing";
  const blobLabel = health.blob?.configured
    ? "Blob ready"
    : health.hosting === "vercel"
      ? "Blob unset"
      : "Local disk";
  const blobTone = health.blob?.configured
    ? "text-[var(--teal)]"
    : health.hosting === "vercel"
      ? "text-[var(--gold)]"
      : "text-[var(--muted)]";
  const blobTitle = health.blob?.configured
    ? "Vercel Blob is connected."
    : health.hosting === "vercel"
      ? "Connect a Blob store on this Vercel project so uploads and jobs persist."
      : "Saving clips on this machine.";

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-black/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]">
      <span className={health.ffmpeg.ok ? "text-[var(--teal)]" : "text-[var(--err)]"}>
        {cpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={gpuTone} title={gpuTitle}>
        {gpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={blobTone} title={blobTitle}>
        {blobLabel}
      </span>
    </div>
  );
}
