import { Library } from "lucide-react";
import { Developers } from "./Developers.tsx";
import { Features } from "./Features.tsx";
import { Hero } from "./Hero.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import { REPO, repoPath } from "./links.ts";
import { Nav } from "./Nav.tsx";
import { QuickStart } from "./QuickStart.tsx";

const FOOTER_LINKS = [
  { href: REPO, label: "GitHub" },
  { href: repoPath("docs/user-manual/README.md"), label: "User manual" },
  { href: repoPath("docs/architecture/overview.md"), label: "Architecture" },
  { href: repoPath("CONTRIBUTING.md"), label: "Contributing" },
];

/** The marketing page: one scrolling page in the app's own look. */
export function App() {
  return (
    <div id="top">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-30 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Features />
        <HowItWorks />
        <Developers />
        <QuickStart />
      </main>
      <footer className="border-t border-border px-4 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-sm text-fg-muted">
          <p className="flex items-center gap-2">
            <Library className="size-4 text-accent" aria-hidden="true" />
            <span className="font-mono">kb</span> · modular knowledge management
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="hover:text-fg hover:underline">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
