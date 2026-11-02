import { Button } from "@kb/ui";
import { Component, type ReactNode, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

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
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div role="alert" className="rounded-card border border-border bg-danger-subtle p-4 text-sm">
      <h1 ref={heading} tabIndex={-1} className="font-semibold text-danger">
        Something went wrong in {title}.
      </h1>
      <p className="mt-1">The rest of the app still works.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
        <Link
          to="/"
          className="inline-flex items-center rounded-control px-3 py-1.5 text-sm font-medium hover:bg-surface"
        >
          Go to home
        </Link>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer">Details</summary>
        <p className="mt-1 font-mono text-xs">{message}</p>
      </details>
    </div>
  );
}

/** Keeps a module's render errors inside `<main>`; the shell and other modules keep working. */
export function ModuleBoundary({ title, children }: { title: string; children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Boundary title={title} resetKey={pathname}>
      {children}
    </Boundary>
  );
}
