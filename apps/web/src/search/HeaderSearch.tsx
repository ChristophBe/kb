import type { SearchProvider } from "@kb/module-sdk";
import { cn } from "@kb/ui";
import { ArrowRight, Search } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { resultCount, type SearchGroup, useSearch } from "./useSearch.ts";

/** Hits per group in the popup; the search page shows them all. */
export const POPUP_HITS = 5;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The search page for a query, e.g. "/search?q=report". */
export function searchPageHref(q: string): string {
  return `/search?${new URLSearchParams({ q })}`;
}

interface Option {
  key: string;
  href: string;
}

/**
 * The shell's search field (APG combobox): every provider's top hits in a
 * grouped listbox, plus "See all results" for the search page. ⌘K / Ctrl+K
 * focuses it from anywhere. The popup is portalled to the body, so the
 * sidebar's scroll area doesn't clip it.
 */
export function HeaderSearch({ providers }: { providers: SearchProvider[] }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (key: string) => `${id}-opt-${key}`;

  const q = query.trim();
  const groups = useSearch(providers, query);
  const shown = groups.map((g) => ({ ...g, hits: g.hits.slice(0, POPUP_HITS) }));
  const expanded = open && q !== "" && groups.length > 0;

  const seeAll: Option = { key: "all", href: searchPageHref(q) };
  const options: Option[] = [
    ...shown.flatMap((g, gi) => g.hits.map((h, hi) => ({ key: `${gi}-${hi}`, href: h.href }))),
    seeAll,
  ];
  const active = expanded ? options.find((o) => o.key === activeKey) : undefined;

  // A new query starts without a highlighted option.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the query changes
  useEffect(() => setActiveKey(null), [q]);

  // jsdom has no scrollIntoView, hence the optional call.
  useEffect(() => {
    if (active)
      document.getElementById(optionId(active.key))?.scrollIntoView?.({ block: "nearest" });
  });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setQuery("");
    setOpen(false);
    input.current?.blur();
    navigate(href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!expanded) {
          setOpen(true);
          return;
        }
        const i = options.findIndex((o) => o.key === active?.key);
        const n = options.length;
        const next = e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1;
        setActiveKey(options[next]?.key ?? null);
        return;
      }
      case "Enter": {
        const target = active ?? (q ? seeAll : undefined);
        if (target) {
          e.preventDefault();
          go(target.href);
        }
        return;
      }
      case "Escape":
        if (expanded) {
          e.preventDefault();
          setOpen(false);
          setActiveKey(null);
        } else if (query) {
          e.preventDefault();
          setQuery("");
        }
        return;
    }
  };

  return (
    <search className="block">
      <label htmlFor={`${id}-input`} className="sr-only">
        Search kb
      </label>
      <div
        ref={field}
        className="flex h-9 items-center gap-2 rounded-control border border-border-strong bg-surface px-2.5 hover:border-fg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
      >
        <Search className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={active ? optionId(active.key) : undefined}
          aria-keyshortcuts="Meta+K Control+K"
          placeholder="Search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-fg-muted focus-visible:outline-none"
        />
        {!query && (
          <span aria-hidden="true" className="shrink-0">
            <kbd className="rounded-sm border border-border px-1 font-mono text-xs text-fg-muted">
              {isMac ? "⌘K" : "Ctrl K"}
            </kbd>
          </span>
        )}
      </div>
      <p role="status" className="sr-only">
        {expanded ? announce(shown) : ""}
      </p>
      {expanded &&
        createPortal(
          <Popup
            anchor={field}
            listId={listId}
            groups={shown}
            query={q}
            activeKey={active?.key}
            optionId={optionId}
            onHover={setActiveKey}
            onPick={go}
            seeAllHref={seeAll.href}
          />,
          document.body,
        )}
    </search>
  );
}

/** What the live region says: the hits shown, groups still loading, groups that failed. */
function announce(groups: SearchGroup[]): string {
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  const loading = groups.some((g) => g.status === "loading");
  const errors = groups.flatMap((g) => (g.error ? [g.error] : []));
  const head =
    total > 0
      ? `${resultCount(total)}${loading ? ", still searching" : ""}.`
      : loading
        ? "Searching…"
        : "No results.";
  return [head, ...errors].join(" ");
}

function Popup({
  anchor,
  listId,
  groups,
  query,
  activeKey,
  optionId,
  onHover,
  onPick,
  seeAllHref,
}: {
  anchor: React.RefObject<HTMLDivElement | null>;
  listId: string;
  groups: SearchGroup[];
  query: string;
  activeKey: string | undefined;
  optionId: (key: string) => string;
  onHover: (key: string) => void;
  onPick: (href: string) => void;
  seeAllHref: string;
}) {
  const style = useAnchoredStyle(anchor);
  const optionClass = (key: string) =>
    cn("block cursor-pointer rounded-control px-3 py-2", key === activeKey && "bg-surface-muted");
  const optionProps = (key: string, href: string) => ({
    id: optionId(key),
    role: "option" as const,
    "aria-selected": key === activeKey,
    className: optionClass(key),
    onMouseMove: () => key !== activeKey && onHover(key),
    onClick: () => onPick(href),
  });
  return (
    <div
      id={listId}
      role="listbox"
      aria-label="Search results"
      style={style}
      // Clicks keep the focus in the field, so it doesn't blur and close the popup first.
      onMouseDown={(e) => e.preventDefault()}
      className="glass-strong fixed z-50 overflow-y-auto rounded-card p-1.5"
    >
      {groups.map((g, gi) => {
        if (g.status === "done" && g.hits.length === 0) return null;
        const headingId = `${listId}-g${gi}`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role="group", not a fieldset
          <div key={g.label} role="group" aria-labelledby={headingId} className="pb-1">
            <div
              role="presentation"
              id={headingId}
              className="flex items-center gap-2 px-3 pt-2 pb-1 font-mono text-xs tracking-wide text-fg-muted uppercase"
            >
              {g.label}
              {g.status === "loading" && (
                <span
                  aria-hidden="true"
                  data-testid="group-spinner"
                  className="inline-block size-3 animate-spin rounded-full border-2 border-border border-t-accent"
                />
              )}
            </div>
            {g.status === "error" && (
              <div role="presentation" className="px-3 py-2 text-sm text-danger">
                {g.error}
              </div>
            )}
            {g.status === "loading" && g.hits.length === 0 && (
              <div role="presentation" className="px-3 py-2 text-sm text-fg-muted">
                Searching…
              </div>
            )}
            {g.hits.map((h, hi) => {
              const key = `${gi}-${hi}`;
              return (
                <div key={key} {...optionProps(key, h.href)}>
                  <span className="block truncate text-sm text-fg">{h.title}</span>
                  {h.snippet && (
                    <span className="mt-0.5 line-clamp-2 text-xs wrap-anywhere text-fg-muted">
                      {h.snippet}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <div
        {...optionProps("all", seeAllHref)}
        className={cn(optionClass("all"), "flex items-center gap-2 text-sm text-fg")}
      >
        <ArrowRight className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="min-w-0 truncate">See all results for “{query}”</span>
      </div>
    </div>
  );
}

/** Places the popup under the field, as wide as the viewport allows (up to 32 rem). */
function useAnchoredStyle(anchor: React.RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const update = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const gutter = 12;
      const top = r.bottom + 8;
      // Stays inside what's visible, also on a phone that shows only part of a wider page.
      const view = window.visualViewport;
      const viewLeft = view?.offsetLeft ?? 0;
      const viewWidth = view?.width ?? window.innerWidth;
      const viewHeight = view?.height ?? window.innerHeight;
      const left = Math.max(viewLeft + gutter, r.left);
      const width = Math.min(512, viewLeft + viewWidth - left - gutter);
      setStyle({ top, left, width, maxHeight: viewHeight - top - gutter });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [anchor]);
  return style;
}
