import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.ts";

export type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface text-fg hover:bg-surface-muted",
  ghost: "text-fg hover:bg-surface-muted",
  danger: "text-danger hover:bg-danger-subtle",
};

/** Button styling, for links that act as calls to action. */
export function buttonClass(variant: Variant = "primary", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control px-3.5 py-1.5 text-sm font-medium transition-[background-color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-card border border-border bg-surface", className)} {...props} />
  );
}

/**
 * A frosted, full-height region of the layout (the sidebar, a list pane),
 * flush with its neighbours and divided from them by a hairline.
 */
export function Area({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass-area flex h-screen flex-col border-border", className)} {...props} />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-control border border-border-strong bg-surface px-3 py-1.5 text-sm hover:border-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-control border border-border-strong bg-surface px-3 py-2 text-sm hover:border-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-neutral-subtle text-neutral",
  info: "bg-info-subtle text-info",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
};

/** A status pill. Write the label in sentence case. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function PageTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h1 className={cn("text-2xl font-medium wrap-anywhere text-fg sm:text-3xl", className)}>
      {children}
    </h1>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  /** Short mono label above the title, e.g. the path "kb / documents". */
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 font-mono text-xs text-fg-muted">{eyebrow}</p>}
        <PageTitle>{title}</PageTitle>
        {description && <p className="mt-2 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-fg-muted">{children}</div>;
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="rounded-control bg-danger-subtle px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

/**
 * A margin note for a citation, shown beside the text it supports. Render it
 * in a `<ul aria-label="Sources">`. `active` marks it while its marker in the
 * text is hovered or focused.
 */
export function SourceNote({
  n,
  title,
  detail,
  snippet,
  active = false,
}: {
  n: number;
  title: ReactNode;
  detail?: string;
  snippet?: string;
  active?: boolean;
}) {
  return (
    <li
      className={cn(
        "border-l-2 pl-3 text-xs transition-colors",
        active ? "border-accent" : "border-border",
      )}
    >
      <p className="font-medium text-fg">
        <span className="font-mono">[{n}]</span> {title}
      </p>
      {detail && <p className="mt-0.5 font-mono text-fg-muted">{detail}</p>}
      {snippet && <p className="mt-1 line-clamp-3 text-fg-muted">{snippet}</p>}
    </li>
  );
}

/** Long documents share ticks, so the strip stays a compact glyph. */
const MAX_TICKS = 48;

/**
 * A document as a barcode: one tick per chunk, so length shows at a glance,
 * with `marked` chunks (zero-based positions, e.g. cited ones) taller and in
 * the accent. The text next to it carries the same information for screen readers.
 */
export function ChunkStrip({
  count,
  marked = [],
  className,
}: {
  count: number;
  marked?: number[];
  className?: string;
}) {
  const ticks = Math.min(count, MAX_TICKS);
  const hits = new Set(marked.map((i) => Math.floor((i * ticks) / count)));
  const cited = new Set(marked).size;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {ticks > 0 && (
        <span aria-hidden="true" className="flex h-3 items-end gap-px">
          {Array.from({ length: ticks }, (_, i) => (
            <span
              key={i}
              data-marked={hits.has(i) || undefined}
              className={cn("w-0.5", hits.has(i) ? "h-3 bg-accent" : "h-2 bg-border-strong")}
            />
          ))}
        </span>
      )}
      <span className="font-mono text-xs text-fg-muted tabular-nums">
        {count} {count === 1 ? "chunk" : "chunks"}
        {cited > 0 && `, ${cited} cited`}
      </span>
    </span>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-border border-t-accent",
        className,
      )}
    />
  );
}
