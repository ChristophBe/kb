import type { KbModule, RuntimeConfig } from "@kb/module-sdk";
import { Area, navItemClass } from "@kb/ui";
import { CircleHelp, FlaskConical, Library } from "lucide-react";
import { useMemo } from "react";
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider } from "react-router";
import { Home } from "./Home.tsx";
import { HelpIndex, HelpPage } from "./help/Help.tsx";
import { ModuleBoundary } from "./ModuleBoundary.tsx";
import { activeModules, navEntries } from "./registry.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { ToastHost } from "./ToastHost.tsx";

export function App({ config }: { config: RuntimeConfig }) {
  const router = useMemo(() => {
    const modules = activeModules(config);
    return createBrowserRouter([
      {
        element: <Shell modules={modules} />,
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
          { path: "help", element: <HelpIndex /> },
          { path: "help/:page", element: <HelpPage /> },
          // Clickable M1 prototype with mock data (docs/ux/m1), loaded on demand.
          {
            path: "prototype/*",
            lazy: async () => ({ Component: (await import("./prototype/index.tsx")).Prototype }),
          },
          { path: "*", element: <p className="text-sm text-fg-muted">Page not found.</p> },
        ],
      },
    ]);
  }, [config]);
  return <RouterProvider router={router} />;
}

function Shell({ modules }: { modules: KbModule[] }) {
  return (
    <div className="flex min-h-screen">
      <Area className="sticky top-0 w-60 shrink-0 overflow-y-auto border-r">
        <Link to="/" className="flex items-center gap-2 px-5 py-5 font-semibold">
          <Library className="size-5 text-accent" aria-hidden="true" />
          <span className="font-mono font-medium">kb</span>
          <span className="text-fg-muted">/</span> Knowledge Base
        </Link>
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
        <nav
          aria-label="Preview"
          className="mt-6 flex flex-col gap-0.5 border-t border-border px-3 pt-4"
        >
          <span className="px-3 pb-1 font-mono text-xs font-medium tracking-wide text-fg-muted uppercase">
            Preview
          </span>
          <NavLink to="/prototype" className={({ isActive }) => navItemClass(isActive)}>
            <FlaskConical className="size-4" aria-hidden="true" /> M1 prototype
          </NavLink>
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
