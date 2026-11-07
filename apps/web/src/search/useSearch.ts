import {
  Code,
  ConnectError,
  type SearchHit,
  type SearchProvider,
  useSearchContext,
} from "@kb/module-sdk";
import { useEffect, useState } from "react";

/** One provider's results for the current query. */
export interface SearchGroup {
  label: string;
  /** `loading` keeps the previous query's hits until the new ones arrive. */
  status: "loading" | "done" | "error";
  hits: SearchHit[];
  /** A readable message when `status` is "error". */
  error?: string;
}

/** How long typing has to pause before the providers run. */
export const SEARCH_DEBOUNCE_MS = 200;

/**
 * Runs every provider in parallel for `query`, `delay` ms after it last
 * changed, and aborts the previous run. Each group settles on its own, so a
 * slow or failing provider doesn't hold up the others. No query, no groups.
 */
export function useSearch(providers: SearchProvider[], query: string, delay = SEARCH_DEBOUNCE_MS) {
  const context = useSearchContext();
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const q = query.trim();

  useEffect(() => {
    if (!q) {
      setGroups([]);
      return;
    }
    const controller = new AbortController();
    const settle = (i: number, group: Partial<SearchGroup>) => {
      if (controller.signal.aborted) return;
      setGroups((prev) => prev.map((g, j) => (j === i ? { ...g, ...group } : g)));
    };
    const timer = setTimeout(() => {
      setGroups((prev) =>
        providers.map((p, i) => ({ label: p.label, status: "loading", hits: prev[i]?.hits ?? [] })),
      );
      providers.forEach((p, i) => {
        // `then` also turns a provider that throws synchronously into a rejection.
        Promise.resolve()
          .then(() => p.search(q, controller.signal, context))
          .then(
            (hits) => settle(i, { status: "done", hits, error: undefined }),
            (err: unknown) =>
              settle(i, { status: "error", hits: [], error: errorMessage(p.label, err) }),
          );
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [providers, q, delay, context]);

  return groups;
}

function errorMessage(label: string, err: unknown): string {
  if (err instanceof ConnectError && err.code === Code.Unavailable)
    return `${label} isn't available right now.`;
  return `Couldn't search ${label}.`;
}

/** "1 result" / "3 results". */
export function resultCount(n: number): string {
  return `${n} ${n === 1 ? "result" : "results"}`;
}
