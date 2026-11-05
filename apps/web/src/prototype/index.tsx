import { Button, Card, cn, PageHeader } from "@kb/ui";
import { FlaskConical } from "lucide-react";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation } from "react-router";
import { ChatIndex, ChatLayout, Conversation, NewScopedChat } from "./Chat.tsx";
import { DocumentDetail, DocumentList, Search } from "./Documents.tsx";
import { Ingestion } from "./Ingestion.tsx";
import { StoreProvider, useStore } from "./store.tsx";
import {
  ScenarioProvider,
  Skeleton,
  SkeletonRows,
  scenarios,
  ToastProvider,
  useScenario,
  useToast,
} from "./ui.tsx";

// Clickable prototype of the M1 screens (docs/ux/m1), mounted by the shell at
// /prototype. Mock data only; the real screens are built in the module UIs.

const DRAFT = "https://github.com/ChristophBe/kb/blob/main/docs/ux/m1";

export function Prototype() {
  return (
    <StoreProvider>
      <ScenarioProvider>
        <ToastProvider>
          <Routes>
            <Route element={<PrototypeLayout />}>
              <Route index element={<Overview />} />
              <Route path="documents" element={<DocumentList />} />
              <Route path="documents/:id" element={<DocumentDetail />} />
              <Route path="search" element={<Search />} />
              <Route path="ingestion" element={<Ingestion />} />
              <Route path="chat" element={<ChatLayout />}>
                <Route index element={<ChatIndex />} />
                <Route path="new" element={<NewScopedChat />} />
                <Route path=":id" element={<Conversation />} />
              </Route>
              <Route path="shell" element={<ShellStates />} />
            </Route>
          </Routes>
        </ToastProvider>
      </ScenarioProvider>
    </StoreProvider>
  );
}

const areas = [
  { to: "", label: "Overview", end: true },
  { to: "documents", label: "Documents" },
  { to: "search", label: "Search" },
  { to: "ingestion", label: "Ingestion" },
  { to: "chat", label: "Chat" },
  { to: "shell", label: "Shell states" },
];

function PrototypeLayout() {
  const { pathname } = useLocation();
  const { reset } = useStore();
  const toast = useToast();
  const content = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // After a route change, move focus to the new page's heading and update the
  // document title (docs/ux/m1/README.md).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on route changes.
  useEffect(() => {
    const heading = content.current?.querySelector<HTMLElement>("h1");
    document.title = `${heading?.textContent ?? "Prototype"} · Prototype · Knowledge Base`;
    if (first.current) {
      first.current = false;
      return;
    }
    if (heading && !content.current?.contains(document.activeElement)) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [pathname]);

  return (
    <div>
      <div className="mb-4 rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm">
            <FlaskConical className="size-4 text-fg-muted" aria-hidden="true" />
            <span>
              <strong>M1 prototype.</strong> Mock data; changes last until you reload.{" "}
              <a href={`${DRAFT}/README.md`} className="underline">
                Design draft
              </a>
            </span>
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              toast("info", "Mock data reset");
            }}
          >
            Reset data
          </Button>
        </div>
        <ScenarioSwitcher />
        <nav
          aria-label="Prototype areas"
          className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3"
        >
          {areas.map((a) => (
            <NavLink
              key={a.label}
              to={a.to}
              end={a.end}
              className={({ isActive }) =>
                cn(
                  "rounded-control px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-muted",
                  isActive && "bg-accent-subtle font-medium text-accent hover:bg-accent-subtle",
                )
              }
            >
              {a.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div ref={content}>
        <Outlet />
      </div>
    </div>
  );
}

function ScenarioSwitcher() {
  const { scenario, setScenario } = useScenario();
  return (
    <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <legend className="float-left mr-2 font-medium">Simulate</legend>
      {scenarios.map((s) => (
        <label key={s.id} className="flex items-center gap-1.5">
          <input
            type="radio"
            name="scenario"
            value={s.id}
            checked={scenario === s.id}
            onChange={() => setScenario(s.id)}
          />
          {s.label}
        </label>
      ))}
    </fieldset>
  );
}

function Overview() {
  const tries: [string, string, string, ReactNode][] = [
    [
      "documents",
      "Documents",
      "documents.md",
      "Open a document, edit its title (Enter / Esc), edit metadata (try an empty or duplicate key), switch to Chunks and page through them, delete it and undo from the toast.",
    ],
    [
      "search",
      "Search",
      "documents.md",
      'Search for "revenue growth"; results link to the chunk. Submit an empty query to see validation.',
    ],
    [
      "ingestion",
      "Ingestion",
      "ingestion.md",
      'Choose or drop files. A name containing "fail" breaks the upload (Retry upload), "scan" fails processing (Retry processing), other formats are rejected.',
    ],
    [
      "chat",
      "Chat",
      "chat.md",
      'Ask about revenue; citations link to chunks. Stop an answer with Esc, put "fail" in a question to interrupt it, rename, change the document scope, delete a conversation.',
    ],
    [
      "shell",
      "Shell states",
      "shell.md",
      "Toasts, the per-module error boundary and loading skeletons.",
    ],
  ];
  return (
    <div>
      <PageHeader
        eyebrow="kb / prototype"
        title="M1 prototype"
        description="Click through the M1 screens before they are built. Everything runs in the browser with mock data."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {tries.map(([to, title, doc, text]) => (
          <Card key={to} className="p-4">
            <h2 className="font-semibold">
              <Link to={to} className="hover:underline">
                {title}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-fg-muted">{text}</p>
            <a href={`${DRAFT}/${doc}`} className="mt-2 inline-block text-sm underline">
              Draft: {doc}
            </a>
          </Card>
        ))}
      </div>
      <p className="mt-6 max-w-2xl text-sm text-fg-muted">
        Use <strong>Simulate</strong> above to see every screen's loading, empty, error and
        service-unavailable state. Try the flows with the keyboard only and with a screen reader;
        the notes in the draft say what should be announced.
      </p>
    </div>
  );
}

class ErrorBoundary extends Component<
  { module: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <div role="alert" className="rounded-card border border-border bg-danger-subtle p-4 text-sm">
        <h2 className="font-semibold text-danger">Something went wrong in {this.props.module}.</h2>
        <p className="mt-1">The rest of the app still works.</p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Link
            to=".."
            relative="path"
            className="inline-flex items-center rounded-control px-3 py-1.5 text-sm font-medium hover:bg-surface"
          >
            Go to overview
          </Link>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-1 font-mono text-xs">{error.message}</p>
        </details>
      </div>
    );
  }
}

function Thrower(): ReactNode {
  throw new Error("Render failed in the demo module.");
}

function ShellStates() {
  const toast = useToast();
  const [broken, setBroken] = useState(false);
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="kb / prototype / shell"
        title="Shell states"
        description="Building blocks every module uses (#58): toasts, the error boundary, loading."
      />
      <section aria-labelledby="toasts-heading">
        <h2 id="toasts-heading" className="mb-2 text-lg font-semibold">
          Toasts
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              toast("success", "Document deleted", { label: "Undo delete", onSelect: () => {} })
            }
          >
            Success with undo
          </Button>
          <Button variant="secondary" onClick={() => toast("info", "Upload finished")}>
            Info
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast("error", "Couldn't rename the conversation. Try again.")}
          >
            Error (stays until dismissed)
          </Button>
        </div>
      </section>
      <section aria-labelledby="boundary-heading">
        <h2 id="boundary-heading" className="mb-2 text-lg font-semibold">
          Error boundary
        </h2>
        <ErrorBoundary module="Demo module">
          {broken ? (
            <Thrower />
          ) : (
            <Card className="flex items-center justify-between gap-4 p-4 text-sm">
              A module page that renders fine.
              <Button variant="danger" onClick={() => setBroken(true)}>
                Make it throw
              </Button>
            </Card>
          )}
        </ErrorBoundary>
        {broken && (
          <Button variant="ghost" className="mt-2" onClick={() => setBroken(false)}>
            Repair demo module
          </Button>
        )}
      </section>
      <section aria-labelledby="loading-heading">
        <h2 id="loading-heading" className="mb-2 text-lg font-semibold">
          Loading
        </h2>
        <Card aria-busy="true">
          <span className="sr-only">Loading documents</span>
          <div aria-hidden="true">
            <SkeletonRows />
          </div>
        </Card>
        <div className="mt-3 flex gap-3" aria-hidden="true">
          <Skeleton className="h-24 flex-1" />
          <Skeleton className="h-24 flex-1" />
        </div>
      </section>
    </div>
  );
}
