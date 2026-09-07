"use client";

import { formatFps, formatResolution } from "@/lib/format";
import {
  FPS_OPTIONS,
  PRESETS,
  SCALE_OPTIONS,
  outputSizeNotice,
  resolveOutputTarget,
  scaleExceeds8k,
  settingsFromPreset,
  withCustomOverride,
} from "@/lib/settings";
import type { EnginePreference, HealthStatus, JobSettings, VideoMeta } from "@/lib/types";

type Props = {
  settings: JobSettings;
  meta: VideoMeta | null;
  health: HealthStatus | null;
  working: boolean;
  canEnhance: boolean;
  onChange: (settings: JobSettings) => void;
  onEnhance: () => void;
};

export function EnhancePanel({
  settings,
  meta,
  health,
  working,
  canEnhance,
  onChange,
  onEnhance,
}: Props) {
  const target = meta ? resolveOutputTarget(meta, settings) : null;
  const sizeNotice = target ? outputSizeNotice(target) : null;
  const engines: { id: EnginePreference; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "gpu", label: "GPU" },
    { id: "cpu", label: "CPU" },
  ];

  return (
    <aside className="panel flex h-full flex-col rounded-[28px] p-6">
      <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Enhance</p>
      <h2 className="mt-2 font-serif text-3xl tracking-tight">Choose a treatment</h2>
      <div className="mt-6 grid gap-2">
        {PRESETS.map((preset) => {
          const active = settings.preset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(settingsFromPreset(preset.id))}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                active
                  ? "border-[var(--gold)] bg-[rgba(226,181,122,0.08)]"
                  : "border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}
            >
              <span className="block text-sm">{preset.label}</span>
              <span className="mt-1 block text-xs text-[var(--muted)]">{preset.blurb}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Resolution</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SCALE_OPTIONS.map((option) => {
            const over8k =
              meta !== null &&
              (option.id === "2x" || option.id === "4x") &&
              scaleExceeds8k(meta, option.id);
            return (
              <Chip
                key={option.id}
                active={settings.scale === option.id}
                disabled={over8k}
                label={option.label}
                title={over8k ? "Would exceed 8K. That size is not allowed." : undefined}
                onClick={() => onChange(withCustomOverride(settings, { scale: option.id }))}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Frame rate</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FPS_OPTIONS.map((option) => (
            <Chip
              key={option.id}
              active={settings.fps === option.id}
              label={option.id === "keep" ? "Keep" : `${option.label} fps`}
              onClick={() => onChange(withCustomOverride(settings, { fps: option.id }))}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 flex gap-3">
        <Toggle
          label="Denoise"
          on={settings.denoise}
          onClick={() => onChange(withCustomOverride(settings, { denoise: !settings.denoise }))}
        />
        <Toggle
          label="Sharpen"
          on={settings.sharpen}
          onClick={() => onChange(withCustomOverride(settings, { sharpen: !settings.sharpen }))}
        />
      </div>

      <div className="mt-6">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Engine</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {engines.map((engine) => (
            <Chip
              key={engine.id}
              active={settings.enginePreference === engine.id}
              disabled={engine.id === "gpu" && health !== null && (!health.gpu.configured || !health.r2?.configured)}
              label={engine.label}
              title={
                engine.id === "gpu" && health !== null && !health.r2?.configured
                  ? "Cloudflare R2 is required before GPU can store a private master."
                  : engine.id === "gpu" && health !== null && !health.gpu.configured
                    ? "GPU key is not configured on this deployment."
                    : undefined
              }
              onClick={() => onChange({ ...settings, enginePreference: engine.id })}
            />
          ))}
        </div>
        {health && !health.gpu.configured ? (
          <p className="mt-3 text-[11px] leading-5 text-[var(--gold)]">{health.gpu.message}</p>
        ) : health && !health.r2?.configured ? (
          <p className="mt-3 text-[11px] leading-5 text-[var(--gold)]">
            GPU needs private R2 so the worker can upload the master without sending bytes through Vercel.
          </p>
        ) : null}
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {target && meta ? (
          <div className="rounded-2xl border border-[var(--line)] bg-black/25 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
            {formatResolution(meta.width, meta.height)} {formatFps(meta.fps)}
            <span className="mx-2 text-[var(--gold)]">→</span>
            {formatResolution(target.width, target.height)} {formatFps(target.fps)}
          </div>
        ) : null}

        {sizeNotice ? (
          <p
            role="status"
            className="rounded-2xl border border-[var(--gold)]/40 bg-[rgba(226,181,122,0.08)] px-4 py-3 text-[12px] leading-5 text-[var(--warn)]"
          >
            {sizeNotice.message}
          </p>
        ) : null}

        <button
          type="button"
          disabled={!canEnhance || working}
          onClick={onEnhance}
          className="w-full rounded-full bg-[linear-gradient(180deg,#f3d7a8,#c48a42)] px-5 py-4 text-sm uppercase tracking-[0.22em] text-[#2a1c0a] disabled:opacity-40"
        >
          {working ? "Working…" : "Enhance video"}
        </button>
        <p className="text-center text-[11px] text-[var(--muted)]">
          GPU uses SeedVR2 + RIFE 4.9 on an RTX 4090. Results above 4K show a warning; nothing above 8K is allowed.
        </p>
      </div>
    </aside>
  );
}

function Chip({
  active,
  label,
  onClick,
  disabled = false,
  title,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.14em] ${
        disabled
          ? "cursor-not-allowed border border-[var(--line)] text-[var(--muted)] opacity-40"
          : active
            ? "bg-[var(--ink)] text-[var(--bg)]"
            : "border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
    </button>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-2xl border px-3 py-3 text-xs uppercase tracking-[0.16em] ${
        on ? "border-[var(--gold)] text-[var(--gold)]" : "border-[var(--line)] text-[var(--muted)]"
      }`}
    >
      {label}
    </button>
  );
}
