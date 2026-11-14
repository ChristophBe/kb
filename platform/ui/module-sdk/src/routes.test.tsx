import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Link, Outlet, type RouteObject, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { useModuleRoutes } from "./routes.tsx";

// A pathless layout whose links are relative, as module layouts have them.
const routes: RouteObject[] = [
  {
    element: (
      <>
        <Link to="n2">Second</Link>
        <Outlet />
      </>
    ),
    children: [
      { index: true, element: <p>list</p> },
      { path: ":id", element: <p>note page</p> },
    ],
  },
];

function Mounted() {
  return useModuleRoutes(routes);
}

describe("useModuleRoutes", () => {
  it("resolves a layout's relative link against the module root, not the open page", () => {
    const router = createMemoryRouter([{ path: "m/notes/*", element: <Mounted /> }], {
      initialEntries: ["/m/notes/n1"],
    });
    render(<RouterProvider router={router} />);
    fireEvent.click(screen.getByRole("link", { name: "Second" }));
    expect(router.state.location.pathname).toBe("/m/notes/n2");
    expect(screen.getByText("note page")).toBeTruthy();
  });
});
