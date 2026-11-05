import { dismissToast, type Toast, useToasts } from "@kb/module-sdk";
import { cn } from "@kb/ui";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";

const AUTO_DISMISS_MS = 5000;

const icons = { success: CheckCircle2, info: Info, error: AlertTriangle };

/** Renders the toasts. Both live regions exist from page load, so that the first is announced. */
export function ToastHost() {
  const toasts = useToasts();
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      <div role="status" className="flex flex-col gap-2">
        {toasts
          .filter((t) => t.kind !== "error")
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
      <div role="alert" className="flex flex-col gap-2">
        {toasts
          .filter((t) => t.kind === "error")
          .map((t) => (
            <ToastItem key={t.id} toast={t} />
          ))}
      </div>
    </section>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.kind === "error" || paused) return;
    const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, paused]);
  const Icon = icons[toast.kind];
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: pausing on hover only delays auto-dismiss; focus pauses it for keyboard users.
    // biome-ignore lint/a11y/noStaticElementInteractions: same reason.
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "pointer-events-auto flex items-start gap-3 glass-strong rounded-card px-4 py-3 text-sm",
        toast.kind === "error" && "text-danger",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-fg">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="font-medium underline"
          onClick={() => {
            toast.action?.onSelect();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
        className="inline-flex size-6 items-center justify-center rounded-control text-fg-muted hover:bg-surface-muted"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
