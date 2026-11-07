import type { CSSProperties } from "react";

export const REPO = "https://github.com/ChristophBe/kb";

/** A file or folder on the repository's main branch. */
export function repoPath(path: string) {
  return `${REPO}/blob/main/${path}`;
}

/** Staggers an entrance (`animate-rise`, `animate-stream`); reduced motion makes it instant. */
export function delay(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}
