import { defineManifest } from "@knowcel/module-sdk";
import { Users } from "lucide-react";

// No pages yet: the Teams and Users pages come with the teams and the admin
// directory, so the module has no sidebar entry until then.
export default defineManifest({ id: "iam", title: "Users & teams", icon: Users, nav: [] });
