import { type RouteObject, useRoutes } from "react-router";

/**
 * Renders a module's `routes` inside the shell's splat route (`m/<id>/*`).
 *
 * The routes are wrapped in a route with the path "/" instead of sitting
 * directly under the splat route. A relative link or `navigate()` in a pathless
 * layout route resolves against the nearest route that has a path, and for a
 * splat route that includes whatever the splat matched: `to="c1"` on /m/chat/c2
 * would lead to /m/chat/c2/c1 instead of /m/chat/c1. The wrapper resolves
 * against the module root, as when the module's routes are tested on their own
 * (`renderModule`).
 */
export function useModuleRoutes(routes: RouteObject[]) {
  return useRoutes([{ path: "/", children: routes }]);
}
