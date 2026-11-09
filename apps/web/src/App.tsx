import {
  KbRuntimeProvider,
  type ModuleManifest,
  type RuntimeAuth,
  type RuntimeConfig,
  type SearchProvider,
} from "@kb/module-sdk";
import { Area, IconButton, navItemClass, ThemeToggle } from "@kb/ui";
import { CircleHelp, CircleUser, Library, LogOut } from "lucide-react";
import { lazy, type ReactNode, useMemo } from "react";
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider } from "react-router";
import { AuthGate, useSession } from "./auth/AuthGate.tsx";
import { createUserManager } from "./auth/session.ts";
import { Home } from "./Home.tsx";
import { ModuleBoundary } from "./ModuleBoundary.tsx";
import { ModuleRoutes } from "./ModuleRoutes.tsx";
import { activeModules, navEntries } from "./registry.ts";
import { HeaderSearch } from "./search/HeaderSearch.tsx";
import { searchProviders } from "./search/pages.ts";
import { SearchPage, searchNavEntry } from "./search/SearchPage.tsx";
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
  const app = (auth?: RuntimeAuth) => (
    <KbRuntimeProvider config={config} auth={auth}>
      <Routes config={config} />
    </KbRuntimeProvider>
  );
  return manager ? <AuthGate manager={manager}>{app}</AuthGate> : app();
}

function Routes({ config }: { config: RuntimeConfig }) {
  const router = useMemo(() => {
    const modules = activeModules(config);
    const providers = searchProviders(modules);
    return createBrowserRouter([
      {
        element: <Shell modules={modules} providers={providers} />,
        children: [
          { index: true, element: <Home modules={modules} /> },
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
          { path: "*", element: <p className="text-sm text-fg-muted">Page not found.</p> },
        ],
      },
    ]);
  }, [config]);
  return <RouterProvider router={router} />;
}

function Shell({ modules, providers }: { modules: ModuleManifest[]; providers: SearchProvider[] }) {
  return (
    <div className="flex min-h-screen">
      <Area className="sticky top-0 w-60 shrink-0 overflow-y-auto border-r">
        <Link to="/" className="flex items-center gap-2 px-5 py-5 font-semibold">
          <Library className="size-5 text-accent" aria-hidden="true" />
          <span className="font-mono font-medium">kb</span>
          <span className="text-fg-muted">/</span> Knowledge Base
        </Link>
        <div className="px-3 pb-4">
          <HeaderSearch providers={providers} />
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {[searchNavEntry, ...navEntries(modules)].map(({ to, label, icon: Icon, end }) => (
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
      <main className="min-w-0 flex-1 p-8">
        <Outlet />
      </main>
      <ToastHost />
    </div>
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
