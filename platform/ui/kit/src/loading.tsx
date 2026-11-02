import { type ReactNode, useEffect, useState } from "react";
import { cn } from "./cn.ts";

/** Placeholder for content on its first load. The container announces the loading state. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-control bg-surface-muted", className ?? "h-4")}
    />
  );
}

/** Skeleton for lists and tables; `label` is what screen readers hear, e.g. "Loading documents". */
export function SkeletonRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" className="space-y-3 p-4">
      <span className="sr-only">{label}</span>
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

/** Shows its children only after `delay` ms, so that fast loads don't flicker. */
export function DelayedLoading({ children, delay = 300 }: { children: ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return visible ? children : null;
}
