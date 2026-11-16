import { useSyncExternalStore } from "react";

/** Width below which the shell and two-pane pages collapse (Tailwind's `md`). */
export const NARROW_QUERY = "(max-width: 767.98px)";

/** Whether a media query matches, kept current. False where `matchMedia` is missing (tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
