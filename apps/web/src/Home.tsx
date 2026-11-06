import type { KbModule } from "@kb/module-sdk";
import { buttonClass, Card, cn, PageTitle } from "@kb/ui";
import { ArrowRight, Search } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ModuleBoundary } from "./ModuleBoundary.tsx";

/** A route inside a module; `path` is relative to the module root. */
function modulePath(m: KbModule, path: string) {
  return path ? `/m/${m.id}/${path}` : `/m/${m.id}`;
}

/**
 * The landing page: a hero with search and the main actions, then a showcase
 * of every module's feature, then any module widgets. Everything
 * module-specific comes from `KbModule.feature` and `KbModule.widgets`.
 */
export function Home({ modules }: { modules: KbModule[] }) {
  const searcher = modules.find((m) => m.feature?.search);
  const actions = modules.filter((m) => m.feature && m !== searcher).slice(0, 2);
  const widgets = modules.flatMap((m) =>
    Object.entries(m.widgets ?? {}).map(([name, Widget]) => (
      <ModuleBoundary key={`${m.id}.${name}`} title={m.title} widget>
        <Widget />
      </ModuleBoundary>
    )),
  );
  const featuresId = useId();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 pb-8">
      <header className="mx-auto flex max-w-3xl flex-col items-center pt-8 text-center sm:pt-14">
        <p className="mb-4 font-mono text-xs text-fg-muted">kb / home</p>
        <PageTitle className="text-balance">Your documents, ready to answer.</PageTitle>
        <p className="mt-4 max-w-xl text-base text-pretty text-fg-muted">
          Upload what you know, then search it or ask in plain language. Every answer cites its
          sources.
        </p>
        {searcher?.feature?.search && (
          <HomeSearch to={modulePath(searcher, searcher.feature.search)} />
        )}
        {actions.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {actions.map((m, i) =>
              m.feature ? (
                <Link
                  key={m.id}
                  to={modulePath(m, m.feature.cta.path)}
                  className={buttonClass(i === 0 ? "primary" : "secondary", "px-5 py-2")}
                >
                  <m.icon className="size-4" />
                  {m.feature.cta.label}
                </Link>
              ) : null,
            )}
          </div>
        )}
      </header>

      <section aria-labelledby={featuresId}>
        <h2 id={featuresId} className="mb-4 text-xl font-medium">
          Everything kb can do
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map((m) => (
            <li key={m.id}>
              <FeatureTile module={m} />
            </li>
          ))}
        </ul>
      </section>
      {widgets.length > 0 && <div className="grid gap-4 lg:grid-cols-2">{widgets}</div>}
    </div>
  );
}

/** Searches the module that declared `feature.search`, with the query in `?q=`. */
function HomeSearch({ to }: { to: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const inputId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    navigate(query ? `${to}?${new URLSearchParams({ q: query })}` : to);
  };
  return (
    <search className="mt-8 w-full max-w-xl">
      <form
        onSubmit={submit}
        className="glass flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus"
      >
        <label htmlFor={inputId} className="sr-only">
          Search your documents
        </label>
        <Search className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your documents…"
          className="min-w-0 flex-1 bg-transparent py-2 text-base placeholder:text-fg-muted focus-visible:outline-none"
        />
        <button type="submit" className={buttonClass("primary", "rounded-full px-5 py-2")}>
          Search
        </button>
      </form>
    </search>
  );
}

function FeatureTile({ module: m }: { module: KbModule }) {
  const tile =
    "group flex h-full flex-col gap-3 p-5 transition-[translate,box-shadow] hover:-translate-y-0.5 hover:shadow-glass";
  if (!m.feature) {
    return (
      <Link to={modulePath(m, "")} className="block h-full">
        <Card className={cn(tile, "flex-row items-center")}>
          <m.icon className="size-5 text-fg-muted" />
          <span className="font-medium">{m.title}</span>
        </Card>
      </Link>
    );
  }
  const { headline, description, cta } = m.feature;
  return (
    <Link to={modulePath(m, cta.path)} className="block h-full">
      <Card className={tile}>
        <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-subtle text-accent">
          <m.icon className="size-5" />
        </span>
        <h3 className="font-medium">{headline}</h3>
        <p className="flex-1 text-sm text-fg-muted">{description}</p>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">
          {cta.label}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </Card>
    </Link>
  );
}
