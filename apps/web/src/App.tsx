import type { KbModule, RuntimeConfig, SearchProvider } from "@kb/module-sdk";
import { Area, navItemClass, ThemeToggle } from "@kb/ui";
import { CircleHelp, Library } from "lucide-react";
import { useMemo } from "react";
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider } from "react-router";
import { Home } from "./Home.tsx";
import { HelpIndex, HelpPage } from "./help/Help.tsx";
import { ModuleBoundary } from "./ModuleBoundary.tsx";
import { activeModules, navEntries } from "./registry.ts";
import { HeaderSearch } from "./search/HeaderSearch.tsx";
import { searchProviders } from "./search/pages.ts";
import { SearchPage } from "./search/SearchPage.tsx";
import { ToastHost } from "./ToastHost.tsx";

export function App({ config }: { config: RuntimeConfig }) {
  const router = useMemo(() => {
    const modules = activeModules(config);
    const providers = searchProviders(modules);
    return createBrowserRouter([
      {
        element: <Shell modules={modules} providers={providers} />,
        children: [
          { index: true, element: <Home modules={modules} /> },
          ...modules.map((m) => ({
            path: `m/${m.id}`,
            element: (
              <ModuleBoundary title={m.title}>
                <Outlet />
              </ModuleBoundary>
            ),
            children: m.routes,
          })),
          { path: "search", element: <SearchPage providers={providers} /> },
          { path: "help", element: <HelpIndex /> },
          { path: "help/:page", element: <HelpPage /> },
          { path: "*", element: <p className="text-sm text-fg-muted">Page not found.</p> },
        ],
      },
    ]);
  }, [config]);
  return <RouterProvider router={router} />;
}

function Shell({ modules, providers }: { modules: KbModule[]; providers: SearchProvider[] }) {
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
          {navEntries(modules).map(({ to, label, icon: Icon, end }) => (
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
        <div className="p-3">
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
