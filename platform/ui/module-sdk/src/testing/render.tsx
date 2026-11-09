import type { Transport } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { KbRuntimeProvider } from "../runtime.tsx";
import type { KbModule } from "../types.ts";

/**
 * Renders a module's routes, at `path` relative to the module root, against
 * `transport`: usually `createRouterTransport` from `@connectrpc/connect`,
 * answering the module's RPCs in memory. Every call gets a fresh query cache.
 * Returns the render result and the router, to check navigation.
 */
export function renderModule(module: KbModule, transport: Transport, path = "/") {
  const router = createMemoryRouter(module.routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }} transport={transport} client={client}>
      <RouterProvider router={router} />
    </KbRuntimeProvider>,
  );
  return { ...result, router };
}

/**
 * Renders `ui` inside the runtime, against `transport`, with a fresh query
 * cache; for shell pages that host module components, such as the home page.
 */
export function renderWithRuntime(ui: ReactNode, transport: Transport) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }} transport={transport} client={client}>
      {ui}
    </KbRuntimeProvider>,
  );
}

/**
 * Renders a home-page widget against `transport`, as the home page does:
 * outside the module's routes, at "/", with a fresh query cache.
 */
export function renderWidget(Widget: ComponentType, transport: Transport) {
  const router = createMemoryRouter([{ path: "*", element: <Widget /> }]);
  return { ...renderWithRuntime(<RouterProvider router={router} />, transport), router };
}
