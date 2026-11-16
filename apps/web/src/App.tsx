import {
  KbRuntimeProvider,
  type ModuleManifest,
  type RuntimeAuth,
  type RuntimeConfig,
  type SearchProvider,
  useIsPlatformAdmin,
} from "@knowcel/module-sdk";
import {
  Area,
  IconButton,
  Logo,
  navItemClass,
  PageTitle,
  ThemeToggle,
  useDocumentTitle,
} from "@knowcel/ui";
import { CircleHelp, CircleUser, LogOut } from "lucide-react";
import { lazy, type ReactNode, type RefObject, useEffect, useMemo, useRef } from "react";
import {
  createBrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router";
import { AuthGate, useSession } from "./auth/AuthGate.tsx";
import { createUserManager } from "./auth/session.ts";
import { CurrentUserLoader } from "./CurrentUserLoader.tsx";
import { ModuleBoundary } from "./ModuleBoundary.tsx";
import { ModuleRoutes } from "./ModuleRoutes.tsx";
import { activeModules, navEntries } from "./registry.ts";
import { HeaderSearch } from "./search/HeaderSearch.tsx";
import { searchProviders } from "./search/pages.ts";
import { SearchPage } from "./search/SearchPage.tsx";
import { ToastHost } from "./ToastHost.tsx";

// The user manual and its Markdown renderer load on the first visit to /help.
const HelpIndex = lazy(() => import("./help/Help.tsx").then((m) => ({ default: m.HelpIndex })));
const HelpPage = lazy(() => import("./help/Help.tsx").then((m) => ({ default: m.HelpPage })));

/**
 * The shell: signs the user in through the OIDC provider in `config.auth`
 * (authorization code with PKCE), then renders the app with their token on
 * every call. Without `config.auth` it renders the app right away.
 */
export function App({ config }: { config: RuntimeConfig }) {
  const manager = useMemo(() => config.auth && createUserManager(config.auth), [config]);
  // Who is signed in comes from the IAM module, so only with it and a sign-in.
  const identified = Boolean(config.auth) && activeModules(config).some((m) => m.id === "iam");
  const app = (auth?: RuntimeAuth) => (
    <KbRuntimeProvider config={config} auth={auth}>
      {identified ? (
        <CurrentUserLoader>
          <Routes config={config} />
        </CurrentUserLoader>
      ) : (
        <Routes config={config} />
      )}
    </KbRuntimeProvider>
  );
  return manager ? <AuthGate manager={manager}>{app}</AuthGate> : app();
}

function Routes({ config }: { config: RuntimeConfig }) {
  // The search reads it when it runs, so the router does not restart when the user is known.
  const isPlatformAdmin = useRef(false);
  isPlatformAdmin.current = useIsPlatformAdmin();
  const router = useMemo(() => {
    const modules = activeModules(config);
    const providers = searchProviders(modules, () => isPlatformAdmin.current);
    return createBrowserRouter([
      {
        element: <Shell modules={modules} providers={providers} />,
        children: [
          { index: true, element: <Start modules={modules} /> },
          // A module's code loads on the first visit to its pages.
          ...modules.map((m) => ({
            path: `m/${m.id}/*`,
            element: (
              <ModuleBoundary title={m.title}>
                <ModuleRoutes module={m} />
              </ModuleBoundary>
            ),
          })),
          { path: "search", element: <SearchPage providers={providers} /> },
          { path: "help", element: <Help page={<HelpIndex />} /> },
          { path: "help/:page", element: <Help page={<HelpPage />} /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ]);
  }, [config]);
  return <RouterProvider router={router} />;
}

function Shell({ modules, providers }: { modules: ModuleManifest[]; providers: SearchProvider[] }) {
  const isPlatformAdmin = useIsPlatformAdmin();
  const main = useRef<HTMLElement>(null);
  useFocusOnNavigation(main);
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>
      <Area as="aside" className="sticky top-0 w-60 shrink-0 overflow-y-auto border-r">
        <div className="flex items-center px-5 py-5">
          <Logo size={24} className="font-serif" />
        </div>
        <div className="px-3 pb-4">
          <HeaderSearch providers={providers} />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
          {navEntries(modules, isPlatformAdmin).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => navItemClass(isActive)}
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <nav aria-label="Help" className="mt-auto flex flex-col gap-0.5 px-3 pt-6">
          <NavLink to="/help" className={({ isActive }) => navItemClass(isActive)}>
            <CircleHelp className="size-4" aria-hidden="true" /> Help
          </NavLink>
        </nav>
        <div className="flex flex-col gap-3 p-3">
          <SignedInUser />
          <ThemeToggle />
        </div>
      </Area>
      <main id="main" ref={main} tabIndex={-1} className="min-w-0 flex-1 p-8 outline-none">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  );
}

/**
 * After a route change, moves focus to the new page's `<h1>` (or to `<main>`
 * when there is none), so keyboard and screen-reader users start at the top of
 * the new page instead of on the sidebar link. A module's page loads lazily, so
 * it waits briefly for the heading to appear. The first page load is left alone,
 * including the redirect from the start page.
 */
function useFocusOnNavigation(main: RefObject<HTMLElement | null>) {
  const { pathname } = useLocation();
  const previous = useRef<string | null>(null);
  const skip = useRef(false);
  useEffect(() => {
    const before = previous.current;
    // StrictMode runs effects twice; a repeat for the same path is not a navigation.
    if (before === pathname) return;
    previous.current = pathname;
    if (before === null) {
      skip.current = pathname === "/";
      return;
    }
    if (skip.current) {
      skip.current = false;
      return;
    }
    const root = main.current;
    if (!root) return;
    const focus = () => {
      const h1 = root.querySelector<HTMLElement>("h1");
      if (!h1) return false;
      h1.tabIndex = -1;
      h1.focus({ preventScroll: false });
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => focus() && observer.disconnect());
    observer.observe(root, { childList: true, subtree: true });
    const giveUp = setTimeout(() => {
      observer.disconnect();
      if (!root.contains(document.activeElement)) root.focus();
    }, 2000);
    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
    };
  }, [pathname, main]);
}

function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <div className="flex flex-col items-start gap-3">
      <PageTitle>Page not found</PageTitle>
      <p className="text-sm text-fg-muted">There is nothing at this address.</p>
      <Link to="/" className="text-sm text-accent underline">
        Go to the start page
      </Link>
    </div>
  );
}

/** The entry point: the first page in the sidebar, which is chat when it's enabled. */
function Start({ modules }: { modules: ModuleManifest[] }) {
  const first = navEntries(modules)[0];
  return first ? (
    <Navigate to={first.to} replace />
  ) : (
    <p className="text-sm text-fg-muted">No modules are enabled.</p>
  );
}

/** A help page, with the loading and error states of a module's pages. */
function Help({ page }: { page: ReactNode }) {
  return <ModuleBoundary title="Help">{page}</ModuleBoundary>;
}

function SignedInUser() {
  const session = useSession();
  if (!session) return null;
  return (
    <div className="flex items-center gap-2 px-3">
      <CircleUser className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="sr-only">Signed in as </span>
        <span className="block truncate" title={session.email ?? session.name}>
          {session.name}
        </span>
        {session.email && session.email !== session.name && (
          <span className="block truncate text-xs text-fg-muted" title={session.email}>
            {session.email}
          </span>
        )}
      </p>
      <IconButton label="Sign out" onClick={session.signOut}>
        <LogOut className="size-4" />
      </IconButton>
    </div>
  );
}
