import { buttonClass, ThemeToggle } from "@kb/ui";
import { Library } from "lucide-react";
import { useEffect, useState } from "react";
import { GithubMark } from "./GithubMark.tsx";
import { REPO } from "./links.ts";

const SECTIONS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#developers", label: "Developers" },
];

/** The sticky top bar: the app's wordmark, section links, GitHub and the theme switch. */
export function Nav() {
  return (
    <div className="glass-subtle sticky top-0 z-20 border-b border-border">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-8"
      >
        <a href="#top" className="flex items-center gap-2 font-semibold">
          <Library className="size-5 text-accent" aria-hidden="true" />
          <span className="font-mono font-medium">kb</span>
          <span className="hidden text-fg-muted sm:inline">/</span>
          <span className="hidden sm:inline">Knowledge Base</span>
        </a>
        <ul className="ml-auto hidden items-center gap-1 md:flex">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <a href={s.href} className={buttonClass("ghost", "text-fg-muted hover:text-fg")}>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <a
          href={REPO}
          className={buttonClass("ghost", "ml-auto md:ml-0")}
          aria-label="kb on GitHub"
        >
          <GithubMark className="size-4" />
        </a>
        <div className="w-24">
          <ClientOnlyThemeToggle />
        </div>
      </nav>
    </div>
  );
}

/**
 * The theme switch reads the saved choice from localStorage, which the
 * prerendered HTML can't know; rendering it after hydration avoids a mismatch.
 * The pre-paint script in index.html has already applied the theme itself.
 */
function ClientOnlyThemeToggle() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <ThemeToggle /> : <div className="h-8 rounded-full bg-surface-muted" />;
}
