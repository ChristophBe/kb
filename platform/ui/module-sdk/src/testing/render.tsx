import type { Transport } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
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

/** Renders a home-page widget at `/` against `transport`, like `renderModule`. */
export function renderWidget(Widget: ComponentType, transport: Transport) {
  return renderModule(
    { id: "widget", title: "", icon: () => null, routes: [{ path: "*", element: <Widget /> }] },
    transport,
  );
}
