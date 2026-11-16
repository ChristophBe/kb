import { act, fireEvent, render, screen } from "@testing-library/react";
import { lazy, useState } from "react";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, ModuleBoundary, ModuleLoadError } from "./ModuleBoundary.tsx";

let broken = true;

function Flaky() {
  if (broken) throw new Error("render failed");
  return <p>module content</p>;
}

function Shell() {
  return (
    <>
      <nav>
        <Link to="/m/other">Other</Link>
        <Link to="/m/broken">Broken</Link>
      </nav>
      <Outlet />
    </>
  );
}

function renderApp() {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          {
            path: "m/broken",
            element: (
              <ModuleBoundary title="Documents">
                <Outlet />
              </ModuleBoundary>
            ),
            children: [{ index: true, element: <Flaky /> }],
          },
          { path: "m/other", element: <p>other module</p> },
          { index: true, element: <p>home</p> },
        ],
      },
    ],
    { initialEntries: ["/m/broken"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("ModuleBoundary", () => {
  beforeEach(() => {
    broken = true;
    // React logs every caught render error.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a panel in place of a throwing module and focuses its heading", () => {
    renderApp();
    expect(screen.getByRole("alert")).toBeTruthy();
    const heading = screen.getByRole("heading", { name: "Something went wrong in Documents." });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText("render failed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Other" })).toBeTruthy();
  });

  it("recovers on Try again once the error is gone", () => {
    renderApp();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("module content")).toBeTruthy();
  });

  it("keeps navigation working and recovers when coming back", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("link", { name: "Other" }));
    expect(await screen.findByText("other module")).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole("link", { name: "Broken" }));
    expect(await screen.findByText("module content")).toBeTruthy();
  });

  it("does not touch healthy modules", () => {
    function Stateful() {
      const [n] = useState(1);
      return <p>count {n}</p>;
    }
    render(
      <ModuleBoundaryInRouter>
        <Stateful />
      </ModuleBoundaryInRouter>,
    );
    expect(screen.getByText("count 1")).toBeTruthy();
  });
  it("offers a reload when a lazy page's code can't be loaded", async () => {
    const Page = lazy(() => Promise.reject(new TypeError("Importing a module script failed.")));
    await act(async () => {
      render(
        <ModuleBoundaryInRouter>
          <Page />
        </ModuleBoundaryInRouter>,
      );
    });
    const heading = await screen.findByRole("heading", { name: "Chat couldn't be loaded." });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  });

  it("keeps Try again for render errors that aren't about loading code", () => {
    expect(isChunkLoadError(new Error("render failed"))).toBe(false);
    expect(isChunkLoadError(new ModuleLoadError("Chat", new Error("offline")))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  });
});

function ModuleBoundaryInRouter({ children }: { children: React.ReactNode }) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: <ModuleBoundary title="Chat">{children}</ModuleBoundary>,
    },
  ]);
  return <RouterProvider router={router} />;
}
