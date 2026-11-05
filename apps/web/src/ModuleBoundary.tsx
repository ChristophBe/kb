import { Button, buttonClass } from "@kb/ui";
import { Component, type ReactNode, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

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
        onRetry={() => this.setState({ error: null })}
      />
    );
  }
}

function ErrorPanel({
  title,
  message,
  widget,
  onRetry,
}: {
  title: string;
  message: string;
  widget: boolean;
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
        Something went wrong in {title}.
      </Heading>
      <p className="mt-1">The rest of the app still works.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
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

/**
 * Keeps a module's render errors inside `<main>`, or inside one home-page
 * `widget`; the shell and other modules keep working.
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
      {children}
    </Boundary>
  );
}
