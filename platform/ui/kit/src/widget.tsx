import type { ComponentType, ReactNode } from "react";
import { cn } from "./cn.ts";
import { Card } from "./components.tsx";

/**
 * A home-page widget: a card with a heading, an optional `action` beside it
 * (usually a link to the module's page) and the content. The home page puts
 * widgets under an `h2`, so the title is an `h3`.
 */
export function Widget({
  title,
  icon: Icon,
  action,
  className,
  children,
}: {
  title: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 font-medium">
          {Icon && (
            <span aria-hidden="true" className="contents">
              <Icon className="size-4 text-fg-muted" />
            </span>
          )}
          {title}
        </h3>
        {action && <div className="shrink-0 text-sm">{action}</div>}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

/**
 * A widget's empty or unavailable state: a short, calm line in place of the
 * content. A widget whose data can't be loaded (e.g. the service is down)
 * shows this with `onRetry` instead of an error alert; the rest of the home
 * page carries on.
 */
export function WidgetMessage({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-fg-muted">
      <p>{children}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium text-accent hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}
