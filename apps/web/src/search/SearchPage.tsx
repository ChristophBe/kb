import type { SearchHit, SearchProvider } from "@kb/module-sdk";
import { Button, Card, DelayedLoading, EmptyState, Input, PageHeader, SkeletonRows } from "@kb/ui";
import { Search } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { NavEntry } from "../registry.ts";
import { resultCount, type SearchGroup, useSearch } from "./useSearch.ts";

/** The search page's entry in the sidebar, above the modules' pages. */
export const searchNavEntry: NavEntry = { to: "/search", label: "Search", icon: Search, end: true };

/**
 * Every provider's hits for `?q=`, grouped, so a search can be shared as a
 * link. Groups load and fail independently.
 */
export function SearchPage({ providers }: { providers: SearchProvider[] }) {
  const [params, setParams] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  const [draft, setDraft] = useState(q);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  // Back and Forward change the URL; the field follows.
  useEffect(() => setDraft(q), [q]);
  const groups = useSearch(providers, q, 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = draft.trim();
    if (!query) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    setInvalid(false);
    setParams({ q: query });
  };

  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const settled = groups.length > 0 && groups.every((g) => g.status !== "loading");
  let announcement = "";
  if (q && !settled) announcement = "Searching…";
  else if (q && settled) announcement = `${resultCount(total)} for "${q}"`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="kb / search"
        title="Search"
        description="Results from every area of kb."
      />
      <search className="mb-4 block">
        <form noValidate onSubmit={submit}>
          <label htmlFor={inputId} className="sr-only">
            Search kb
          </label>
          <div className="flex gap-2">
            <Input
              ref={input}
              id={inputId}
              type="search"
              placeholder="Search kb"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (invalid && e.target.value.trim()) setInvalid(false);
              }}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
            />
            <Button type="submit">Search</Button>
          </div>
          {invalid && (
            <p id={errorId} className="mt-1 text-sm text-danger">
              Enter a search term
            </p>
          )}
        </form>
      </search>
      <p role="status" className="mb-6 font-mono text-xs text-fg-muted">
        {announcement}
      </p>
      {q && (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <Group key={g.label} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ group: g }: { group: SearchGroup }) {
  const headingId = useId();
  let body: React.ReactNode;
  if (g.status === "loading" && g.hits.length === 0) {
    body = (
      <DelayedLoading>
        <SkeletonRows label={`Searching ${g.label}`} rows={2} />
      </DelayedLoading>
    );
  } else if (g.status === "error") {
    body = <p className="px-4 py-3 text-sm text-danger">{g.error}</p>;
  } else if (g.hits.length === 0) {
    body = <EmptyState>No matches.</EmptyState>;
  } else {
    body = (
      <ol className="divide-y divide-dotted divide-border">
        {g.hits.map((h, i) => (
          <Hit key={i} hit={h} />
        ))}
      </ol>
    );
  }
  return (
    <section aria-labelledby={headingId} aria-busy={g.status === "loading" || undefined}>
      <h2 id={headingId} className="mb-3 flex items-baseline gap-2 text-lg font-medium">
        {g.label}
        {g.status === "done" && (
          <span className="font-mono text-xs font-normal text-fg-muted tabular-nums">
            {g.hits.length}
          </span>
        )}
      </h2>
      <Card>{body}</Card>
    </section>
  );
}

function Hit({ hit }: { hit: SearchHit }) {
  return (
    <li className="px-4 py-3">
      <Link to={hit.href} className="text-sm font-medium wrap-anywhere hover:underline">
        {hit.title}
      </Link>
      {hit.snippet && (
        <p className="mt-1 line-clamp-3 text-sm wrap-anywhere text-fg-muted">{hit.snippet}</p>
      )}
    </li>
  );
}
