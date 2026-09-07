import type { ToastTone } from "./types";

export type ToastChrome = {
  label: string;
  panel: string;
  kicker: string;
};

const TOAST_CHROME = {
  error: {
    label: "Error",
    panel:
      "border-[color-mix(in_srgb,var(--err)_50%,transparent)] bg-[color-mix(in_srgb,var(--err)_12%,transparent)] border-l-[var(--err)]",
    kicker: "text-[var(--err)]",
  },
  success: {
    label: "Done",
    panel:
      "border-[color-mix(in_srgb,var(--teal)_45%,transparent)] bg-[color-mix(in_srgb,var(--teal)_10%,transparent)] border-l-[var(--teal)]",
    kicker: "text-[var(--teal)]",
  },
  warn: {
    label: "Warning",
    panel:
      "border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] border-l-[var(--warn)]",
    kicker: "text-[var(--warn)]",
  },
  info: {
    label: "Info",
    panel:
      "border-[color-mix(in_srgb,var(--blue)_45%,transparent)] bg-[color-mix(in_srgb,var(--blue)_10%,transparent)] border-l-[var(--blue)]",
    kicker: "text-[var(--blue)]",
  },
} as const satisfies Record<ToastTone, ToastChrome>;

export function toastChrome(tone: ToastTone): ToastChrome {
  return TOAST_CHROME[tone];
}
