"use client";

import { toastChrome } from "@/lib/toast";
import type { Toast } from "@/lib/types";

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

export function ToastViewport({ toasts, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-[min(100%-2rem,360px)] flex-col gap-2">
      {toasts.map((toast) => {
        const chrome = toastChrome(toast.tone);
        return (
          <button
            key={toast.id}
            type="button"
            onClick={() => onDismiss(toast.id)}
            className={`pointer-events-auto rise rounded-2xl border border-l-4 px-4 py-3 text-left shadow-[var(--shadow)] backdrop-blur-xl ${chrome.panel}`}
          >
            <p className={`text-xs uppercase tracking-[0.18em] ${chrome.kicker}`}>
              {chrome.label}
            </p>
            <p className="mt-1 text-sm text-[var(--ink)]">{toast.title}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{toast.body}</p>
          </button>
        );
      })}
    </div>
  );
}
