import { useSyncExternalStore } from "react";

export type ToastKind = "success" | "info" | "error";

export interface ToastAction {
  /** Names the action, e.g. "Undo delete". */
  label: string;
  onSelect: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

/** Older toasts make room, errors last; the shell shows at most this many. */
const MAX_VISIBLE = 3;

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

function show(kind: ToastKind, message: string, action?: ToastAction) {
  const next = [...toasts, { id: nextId++, kind, message, action }];
  // Errors stay until dismissed, so the oldest other toast makes room first.
  while (next.length > MAX_VISIBLE) {
    const i = next.findIndex((t) => t.kind !== "error");
    next.splice(i === -1 || i === next.length - 1 ? 0 : i, 1);
  }
  publish(next);
}

/** Confirms background actions. A plain object, so it also works outside of render. */
export const toast = {
  success: (message: string, options?: { action?: ToastAction }) =>
    show("success", message, options?.action),
  info: (message: string, options?: { action?: ToastAction }) =>
    show("info", message, options?.action),
  /** Stays until dismissed. */
  error: (message: string) => show("error", message),
};

export function dismissToast(id: number) {
  publish(toasts.filter((t) => t.id !== id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current toasts, for the shell's toast host. */
export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}
