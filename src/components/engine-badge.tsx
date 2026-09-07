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
  const gpuLabel = !gpu.configured
    ? "GPU offline"
    : gpu.ready
      ? "GPU ready"
      : "GPU cold";
  const cpuLabel = health.ffmpeg.ok ? "CPU ready" : "CPU missing";

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-black/30 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em]">
      <span className={health.ffmpeg.ok ? "text-[var(--teal)]" : "text-[var(--err)]"}>
        {cpuLabel}
      </span>
      <span className="text-[var(--line-strong)]">·</span>
      <span className={gpuTone} title={gpu.message}>
        {gpuLabel}
      </span>
    </div>
  );
}
