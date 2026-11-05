import type { KbModule, RuntimeConfig } from "@kb/module-sdk";
import { Area, Card, cn, PageTitle } from "@kb/ui";
import { FlaskConical, Library } from "lucide-react";
import { useMemo } from "react";
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider } from "react-router";
import { ModuleBoundary } from "./ModuleBoundary.tsx";
import { activeModules } from "./registry.ts";
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

/** Nav link; the active item is an accent-tinted pill. */
function navItem(isActive: boolean) {
  return cn(
    "flex items-center gap-2 rounded-control px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg",
    isActive && "bg-accent-subtle font-medium text-accent hover:bg-accent-subtle hover:text-accent",
  );
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
          {modules.flatMap((m) =>
            (m.nav ?? [{ path: "", label: m.title, icon: m.icon }]).map((item) => {
              const Icon = item.icon ?? m.icon;
              const to = item.path ? `/m/${m.id}/${item.path}` : `/m/${m.id}`;
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={!item.path}
                  className={({ isActive }) => navItem(isActive)}
                >
                  <Icon className="size-4" /> {item.label}
                </NavLink>
              );
            }),
          )}
        </nav>
        <nav
          aria-label="Preview"
          className="mt-6 flex flex-col gap-0.5 border-t border-border px-3 pt-4"
        >
          <span className="px-3 pb-1 font-mono text-xs font-medium tracking-wide text-fg-muted uppercase">
            Preview
          </span>
          <NavLink to="/prototype" className={({ isActive }) => navItem(isActive)}>
            <FlaskConical className="size-4" aria-hidden="true" /> M1 prototype
          </NavLink>
        </nav>
        <div className="mt-auto p-3 pt-6">
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

function Home({ modules }: { modules: KbModule[] }) {
  const widgets = modules.flatMap((m) =>
    Object.entries(m.widgets ?? {}).map(([name, Widget]) => <Widget key={`${m.id}.${name}`} />),
  );
  return (
    <div>
      <PageTitle className="mb-8">Welcome</PageTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Link key={m.id} to={`/m/${m.id}`}>
            <Card className="flex items-center gap-3 p-5 transition-[translate,box-shadow] hover:-translate-y-0.5 hover:shadow-glass">
              <m.icon className="size-5 text-fg-muted" />
              <span className="font-medium">{m.title}</span>
            </Card>
          </Link>
        ))}
      </div>
      {widgets.length > 0 && <div className="mt-8 grid gap-4 lg:grid-cols-2">{widgets}</div>}
    </div>
  );
}
