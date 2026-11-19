import { Button, brandText, buttonClass, DelayedLoading, SkeletonRows } from "@knowcel/ui";
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
 * A chunk of the app failed to load: a module's code, or a page a
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
        chunk={isChunkLoadError(error)}
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function ErrorPanel({
  title,
  message,
  chunk,
  onRetry,
}: {
  title: string;
  message: string;
  /** The code didn't load, so only a reload helps, rather than trying again. */
  chunk: boolean;
  onRetry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div role="alert" className="rounded-card bg-danger-subtle p-4 text-sm">
      <h1 ref={heading} tabIndex={-1} className="font-semibold text-danger">
        {chunk ? `${title} couldn't be loaded.` : `Something went wrong in ${title}.`}
      </h1>
      <p className="mt-1">
        {chunk
          ? brandText(
              "Knowcelium may have been updated since you opened it. Reload the page to get the latest version.",
            )
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
        <Link to="/" className={buttonClass("ghost", "hover:bg-surface")}>
          Go to start page
        </Link>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer">Details</summary>
        <p className="mt-1 font-mono text-xs">{message}</p>
      </details>
    </div>
  );
}

/**
 * Keeps a module's render errors inside `<main>`; the shell and other modules
 * keep working. It also shows the loading state while the module's code loads
 * (the module's pages suspend; a page shows nothing on fast loads), and offers
 * a reload when that code can't be loaded.
 */
export function ModuleBoundary({ title, children }: { title: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Boundary title={title} resetKey={pathname}>
      <Suspense
        fallback={
          <DelayedLoading>
            <SkeletonRows label={`Loading ${title}`} rows={3} />
          </DelayedLoading>
        }
      >
        {children}
      </Suspense>
    </Boundary>
  );
}
