import { Button, buttonClass, Card, DelayedLoading, SkeletonRows } from "@kb/ui";
import { Component, type ReactNode, Suspense, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

/** A module's code couldn't be imported; see `loadModule`. */
export class ModuleLoadError extends Error {
  constructor(title: string, cause: unknown) {
    super(
      `${title} couldn't be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    );
    this.name = "ModuleLoadError";
  }
}

/**
 * A chunk of the app failed to load: a module's code, or a widget or page a
 * module imports lazily. Mostly the app was redeployed and the old chunk is
 * gone (or the network dropped); reloading the page fixes both. The browsers'
 * messages for a failed `import()`, and Vite's for a failed preload, differ.
 */
export function isChunkLoadError(error: Error): boolean {
  return (
    error instanceof ModuleLoadError ||
    /dynamically imported module|Importing a module script failed|Unable to preload/i.test(
      error.message,
    )
  );
}

interface BoundaryProps {
  title: string;
  /** A change resets the boundary, so that navigating away recovers. */
  resetKey: string;
  widget: boolean;
  children: ReactNode;
}

class Boundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorPanel
        title={this.props.title}
        message={error.message}
        widget={this.props.widget}
        chunk={isChunkLoadError(error)}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function ErrorPanel({
  title,
  message,
  widget,
  chunk,
  onRetry,
}: {
  title: string;
  message: string;
  widget: boolean;
  /** The code didn't load, so only a reload helps, rather than trying again. */
  chunk: boolean;
  onRetry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // A page-level failure takes focus; a widget's doesn't pull focus away from the page.
    if (!widget) heading.current?.focus();
  }, [widget]);
  const Heading = widget ? "h3" : "h1";
  return (
    <div role="alert" className="rounded-card bg-danger-subtle p-4 text-sm">
      <Heading ref={heading} tabIndex={-1} className="font-semibold text-danger">
        {chunk ? `${title} couldn't be loaded.` : `Something went wrong in ${title}.`}
      </Heading>
      <p className="mt-1">
        {chunk
          ? "kb may have been updated since you opened it. Reload the page to get the latest version."
          : "The rest of the app still works."}
      </p>
      <div className="mt-3 flex gap-2">
        {chunk ? (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        ) : (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
        {!widget && (
          <Link to="/" className={buttonClass("ghost", "hover:bg-surface")}>
            Go to home
          </Link>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer">Details</summary>
        <p className="mt-1 font-mono text-xs">{message}</p>
      </details>
    </div>
  );
}

/** What shows while a module's code, or a lazy widget, loads. */
function ModuleLoading({ title, widget }: { title: string; widget: boolean }) {
  const rows = <SkeletonRows label={`Loading ${title}`} rows={widget ? 2 : 3} />;
  // A widget keeps its place in the grid; a page shows nothing on fast loads.
  return widget ? <Card>{rows}</Card> : <DelayedLoading>{rows}</DelayedLoading>;
}

/**
 * Keeps a module's render errors inside `<main>`, or inside one home-page
 * `widget`; the shell and other modules keep working. It also shows the
 * loading state while the module's code loads (the module's pages and lazy
 * widgets suspend), and offers a reload when that code can't be loaded.
 */
export function ModuleBoundary({
  title,
  widget = false,
  children,
}: {
  title: string;
  widget?: boolean;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  return (
    <Boundary title={title} resetKey={pathname} widget={widget}>
      <Suspense fallback={<ModuleLoading title={title} widget={widget} />}>{children}</Suspense>
    </Boundary>
  );
}
