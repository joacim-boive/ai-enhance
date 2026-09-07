"use client";

import type { Toast } from "@/lib/types";

type Props = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

export function ToastViewport({ toasts, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-[min(100%-2rem,360px)] flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="pointer-events-auto rise panel rounded-2xl px-4 py-3 text-left"
        >
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--gold)]">
            {toast.tone}
          </p>
          <p className="mt-1 text-sm">{toast.title}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{toast.body}</p>
        </button>
      ))}
    </div>
  );
}
