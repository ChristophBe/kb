import type { Transport } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { KbRuntimeProvider } from "../runtime.tsx";
import type { KbModule } from "../types.ts";
import { type CurrentUser, CurrentUserProvider, type CurrentUserStatus } from "../user.tsx";

/**
 * Renders a module's routes, at `path` relative to the module root, against
 * `transport`: usually `createRouterTransport` from `@connectrpc/connect`,
 * answering the module's RPCs in memory. Every call gets a fresh query cache.
 * `user` is what `useCurrentUser` returns, `status` what `useCurrentUserStatus` does. Returns the render result and the
 * router, to check navigation.
 */
export function renderModule(
  module: KbModule,
  transport: Transport,
  path = "/",
  user: CurrentUser | null = null,
  status?: CurrentUserStatus,
) {
  const router = createMemoryRouter(module.routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }} transport={transport} client={client}>
      <CurrentUserProvider user={user} status={status}>
        <RouterProvider router={router} />
      </CurrentUserProvider>
    </KbRuntimeProvider>,
  );
  return { ...result, router };
}

/**
 * Renders `ui` inside the runtime, against `transport`, with a fresh query
 * cache; for shell pages that host module components.
 */
export function renderWithRuntime(ui: ReactNode, transport: Transport) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <KbRuntimeProvider config={{ apiBaseUrl: "http://test" }} transport={transport} client={client}>
      {ui}
    </KbRuntimeProvider>,
  );
}
