import { defineManifest } from "@knowcel/module-sdk";
import { UserRoundCog, UsersRound } from "lucide-react";

export default defineManifest({
  id: "iam",
  title: "Teams",
  icon: UsersRound,
  nav: [
    { path: "teams", label: "Teams", icon: UsersRound, order: 40 },
    { path: "users", label: "Users", icon: UserRoundCog, requiresPlatformAdmin: true, order: 50 },
  ],
});
