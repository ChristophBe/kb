import { useCallback, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

/** Also read by the inline script in the index.html of apps/web and apps/site, which applies it before first paint. */
const STORAGE_KEY = "kb.theme";

function isThemePref(value: unknown): value is ThemePref {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePref(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Sets `<html data-theme>`, which pins `color-scheme`; "system" removes it so the OS decides. */
export function applyThemePref(pref: ThemePref) {
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
}

/** The user's light/dark choice, applied to the page and remembered in this browser. */
export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPref] = useState(readThemePref);
  const update = useCallback((next: ThemePref) => {
    setPref(next);
    applyThemePref(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }, []);
  return [pref, update];
}
