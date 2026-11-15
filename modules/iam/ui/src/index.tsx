import { defineModule } from "@knowcel/module-sdk";
import { Navigate } from "react-router";
import manifest from "./manifest.ts";
import { TeamDetail } from "./TeamDetail.tsx";
import { TeamPlaceholder } from "./TeamPlaceholder.tsx";
import { Teams } from "./Teams.tsx";
import { Users } from "./Users.tsx";

export default defineModule({
  ...manifest,
  routes: [
    { index: true, element: <Navigate to="teams" replace /> },
    {
      path: "teams",
      element: <Teams />,
      children: [
        { index: true, element: <TeamPlaceholder /> },
        { path: ":id", element: <TeamDetail /> },
      ],
    },
    { path: "users", element: <Users /> },
  ],
});
