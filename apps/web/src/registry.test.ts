import type { ModuleManifest } from "@knowcel/module-sdk";
import { describe, expect, it } from "vitest";
import { activeModules, navEntries } from "./registry.ts";

const ids = (enabledModules?: string[]) =>
  activeModules({ apiBaseUrl: "", enabledModules }).map((m) => m.id);

describe("activeModules", () => {
  it("shows every compiled-in module when the config names none", () => {
    expect(ids()).toEqual(["chat", "document", "iam", "ingestion", "llm"]);
  });

  it("shows only the enabled modules, in compiled-in order", () => {
    expect(ids(["llm", "chat"])).toEqual(["chat", "llm"]);
  });

  it("ignores unknown ids and shows nothing for an empty list", () => {
    expect(ids(["nope", "document"])).toEqual(["document"]);
    expect(ids([])).toEqual([]);
  });
});

describe("navEntries", () => {
  it("lists a module's nav items, or the module itself when it declares none", () => {
    const entries = navEntries(activeModules({ apiBaseUrl: "" }));
    expect(entries.map((e) => [e.label, e.to, e.end])).toEqual([
      ["Chat", "/m/chat", true],
      ["Documents", "/m/document", true],
      ["Teams", "/m/iam/teams", false],
      ["Ingestion", "/m/ingestion", true],
      ["Models", "/m/llm", true],
    ]);
  });

  it("hides items that require a platform admin until the user is one", () => {
    const Icon = () => null;
    const modules: ModuleManifest[] = [
      {
        id: "x",
        title: "X",
        icon: Icon,
        nav: [
          { path: "", label: "Open" },
          { path: "admin", label: "Admin only", requiresPlatformAdmin: true },
        ],
      },
    ];
    expect(navEntries(modules).map((e) => e.label)).toEqual(["Open"]);
    expect(navEntries(modules, false).map((e) => e.label)).toEqual(["Open"]);
    expect(navEntries(modules, true).map((e) => e.label)).toEqual(["Open", "Admin only"]);
  });
});
