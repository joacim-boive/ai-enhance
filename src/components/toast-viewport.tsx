"use client";

import { toastChrome } from "@/lib/toast";
import type { Toast } from "@/lib/types";

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

export function ToastViewport({ toasts, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-[min(100%-2rem,380px)] flex-col gap-2">
      {toasts.map((toast) => {
        const chrome = toastChrome(toast.tone);
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto rise rounded-2xl border border-l-4 p-4 shadow-[var(--shadow)] backdrop-blur-xl ${chrome.panel}`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className={`text-xs uppercase tracking-[0.18em] font-medium ${chrome.kicker}`}>
                {chrome.label}
              </p>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="text-xs uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--ink)] transition cursor-pointer"
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--ink)]">{toast.title}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{toast.body}</p>
            {toast.action ? (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    onDismiss(toast.id);
                  }}
                  className="rounded-full bg-[linear-gradient(180deg,#f3d7a8,#c48a42)] px-3.5 py-1.5 text-xs uppercase tracking-[0.16em] font-medium text-[#2a1c0a] hover:opacity-90 shadow-sm transition cursor-pointer"
                >
                  {toast.action.label}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
