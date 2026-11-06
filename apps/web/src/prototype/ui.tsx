import { Button, cn, IconButton, Skeleton, Spinner } from "@kb/ui";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

// Interaction patterns used by the M1 prototype (docs/ux-standards.md). They
// follow the WAI-ARIA Authoring Practices and are candidates for @kb/ui once
// M1 implements the real screens (#58).

// --- Scenario -------------------------------------------------------------

export type Scenario = "normal" | "loading" | "empty" | "error" | "unavailable";

export const scenarios: { id: Scenario; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
  { id: "unavailable", label: "Service unavailable" },
];

const ScenarioContext = createContext<{
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
}>({ scenario: "normal", setScenario: () => {} });

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<Scenario>("normal");
  const value = useMemo(() => ({ scenario, setScenario }), [scenario]);
  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export const useScenario = () => useContext(ScenarioContext);

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };

/**
 * Simulates a query: a short first load (so skeletons appear), then data, or
 * the state the scenario switcher selects. `empty` replaces the data.
 */
export function useMockQuery<T>(data: T, empty: T, unavailable = "This service"): Loadable<T> {
  const { scenario } = useScenario();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 500);
    return () => clearTimeout(t);
  }, []);
  if (!loaded || scenario === "loading") {
    return { status: "loading" };
  }
  if (scenario === "error") {
    return { status: "error", message: "Something went wrong while loading." };
  }
  if (scenario === "unavailable") {
    return {
      status: "error",
      message: `${unavailable} isn't available right now. Try again in a moment.`,
    };
  }
  return { status: "success", data: scenario === "empty" ? empty : data };
}

/** Renders the loading / error state of a Loadable, or its content. */
export function LoadState<T>({
  state,
  label,
  skeleton,
  children,
}: {
  state: Loadable<T>;
  label: string;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { setScenario } = useScenario();
  if (state.status === "loading") {
    return (
      <div aria-busy="true">
        <span className="sr-only" role="status">
          {label}
        </span>
        <div aria-hidden="true">{skeleton}</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-danger-subtle px-4 py-3 text-sm text-danger"
      >
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </span>
        <Button variant="secondary" onClick={() => setScenario("normal")}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// --- Dialog and Skeleton come from the kit ------------------------------------

export { Dialog, Skeleton } from "@kb/ui";

// --- Tabs (APG tabs, manual activation) ------------------------------------

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  children,
}: {
  label: string;
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    const tab = tabs[next];
    if (tab) {
      e.preventDefault();
      onChange(tab.id);
      refs.current[tab.id]?.focus();
    }
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${t.id}`}
            aria-selected={value === t.id}
            aria-controls={`${base}-panel`}
            tabIndex={value === t.id ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              value === t.id
                ? "border-accent font-medium text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${value}`}>
        {children}
      </div>
    </div>
  );
}

// --- Menu button (APG menu button) -----------------------------------------

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function MenuButton({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (open) {
      menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]")[active]?.focus();
    }
  }, [open, active]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) {
      button.current?.focus();
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  };
  return (
    <div className="relative inline-block">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
        className="inline-flex size-8 items-center justify-center rounded-control text-fg-muted hover:bg-surface-muted"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setOpen(false);
            }
          }}
          className="absolute right-0 z-10 mt-1 min-w-44 glass-strong rounded-card p-1"
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted focus:bg-surface-muted",
                item.danger ? "text-danger" : "text-fg",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Toasts (one shell-owned polite status and one alert region) -----------

type ToastKind = "success" | "info" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onSelect: () => void };
}

type ShowToast = (kind: ToastKind, message: string, action?: Toast["action"]) => void;

const ToastContext = createContext<ShowToast>(() => {});
export const useToast = () => useContext(ToastContext);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback<ShowToast>((kind, message, action) => {
    setToasts((ts) => [...ts, { id: ++toastId, kind, message, action }].slice(-3));
  }, []);
  const polite = toasts.filter((t) => t.kind !== "error");
  const errors = toasts.filter((t) => t.kind === "error");
  return (
    <ToastContext.Provider value={show}>
      {children}
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        <div role="status" className="flex flex-col gap-2">
          {polite.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" className="flex flex-col gap-2">
          {errors.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.kind === "error" || paused) {
      return;
    }
    const t = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(t);
  }, [toast, paused, onDismiss]);
  const Icon =
    toast.kind === "success" ? CheckCircle2 : toast.kind === "error" ? AlertTriangle : Info;
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
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <IconButton
        label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className="size-6"
      >
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

// --- Small helpers ----------------------------------------------------------

/** A polite live region local to a component, for one-off announcements. */
export function useAnnouncer(): [ReactNode, (message: string) => void] {
  const [message, setMessage] = useState("");
  const announce = useCallback((m: string) => {
    // Clearing first makes screen readers repeat identical messages.
    setMessage("");
    setTimeout(() => setMessage(m), 50);
  }, []);
  return [
    <span key="announcer" role="status" className="sr-only">
      {message}
    </span>,
    announce,
  ];
}

export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <Spinner label={label} /> {label}
    </span>
  );
}

export function relativeTime(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function Time({ date }: { date: Date }) {
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      className="font-mono tabular-nums"
    >
      {relativeTime(date)}
    </time>
  );
}
