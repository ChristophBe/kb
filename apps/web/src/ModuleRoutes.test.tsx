import type { KbModule, LazyModule } from "@kb/module-sdk";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModuleBoundary } from "./ModuleBoundary.tsx";
import { loadModule, ModuleRoutes } from "./ModuleRoutes.tsx";

const Icon = () => <svg aria-hidden="true" />;

function lazyModule(load: LazyModule["load"]): LazyModule {
  return { id: "notes", title: "Notes", icon: Icon, load };
}

const notes: KbModule = {
  id: "notes",
  title: "Notes",
  icon: Icon,
  routes: [
    { index: true, element: <Link to="n1">First note</Link> },
    { path: ":id", element: <p>note page</p> },
  ],
};

// React only retries a suspended render that started in an awaited act().
async function renderShell(module: LazyModule, path: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Link to="/m/notes">Notes</Link>
            <Outlet />
          </>
        ),
        children: [
          { index: true, element: <p>home</p> },
          {
            path: "m/notes/*",
            element: (
              <ModuleBoundary title={module.title}>
                <ModuleRoutes module={module} />
              </ModuleBoundary>
            ),
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

describe("ModuleRoutes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the module on the first visit to its pages, once", async () => {
    const load = vi.fn(async () => ({ default: notes }));
    const module = lazyModule(load);
    await renderShell(module, "/");
    expect(load).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Notes" }));
    });
    fireEvent.click(await screen.findByRole("link", { name: "First note" }));
    expect(await screen.findByText("note page")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    expect(loadModule(module)).toBe(loadModule(module));
  });

  it("shows the loading state while the module's code loads", async () => {
    await renderShell(
      lazyModule(() => new Promise(() => {})),
      "/m/notes",
    );
    // Nothing for fast loads, then the skeleton.
    expect(screen.queryByText("Loading Notes")).toBeNull();
    expect(await screen.findByText("Loading Notes")).toBeTruthy();
  });

  it("offers a reload when the module's code can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    await renderShell(
      lazyModule(() =>
        Promise.reject(new TypeError("Failed to fetch dynamically imported module: /a.js")),
      ),
      "/m/notes/n1",
    );
    const heading = await screen.findByRole("heading", { name: "Notes couldn't be loaded." });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/kb may have been updated since you opened it/)).toBeTruthy();
    expect(
      screen.getByText(
        "Notes couldn't be loaded: Failed to fetch dynamically imported module: /a.js",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalled();
  });
});
