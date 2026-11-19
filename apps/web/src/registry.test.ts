import type { ModuleManifest } from "@knowcel/module-sdk";
import { describe, expect, it } from "vitest";
import { activeModules, navEntries } from "./registry.ts";

const ids = (enabledModules?: string[]) =>
  activeModules({ apiBaseUrl: "", enabledModules }).map((m) => m.id);

describe("activeModules", () => {
  it("shows every compiled-in module when the config names none", () => {
    expect(ids()).toEqual(["chat", "curation", "document", "iam", "ingestion", "llm"]);
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
  it("orders entries by `order` and puts unordered ones last, in module order", () => {
    const Icon = () => null;
    const m = (id: string, order?: number): ModuleManifest => ({
      id,
      title: id,
      icon: Icon,
      order,
    });
    const entries = navEntries([m("a"), m("b", 2), m("c"), m("d", 1)]);
    expect(entries.map((e) => e.label)).toEqual(["d", "b", "a", "c"]);
  });

  it("lists a module's nav items, or the module itself when it declares none", () => {
    const entries = navEntries(activeModules({ apiBaseUrl: "" }));
    expect(entries.map((e) => [e.label, e.to, e.end])).toEqual([
      ["Chat", "/m/chat", false],
      ["Documents", "/m/document", false],
      ["Document checks", "/m/curation", false],
      ["Upload", "/m/ingestion", false],
      ["Teams", "/m/iam/teams", false],
      ["Models", "/m/llm", false],
    ]);
  });

  it("matches a module root exactly only when the module has other entries", () => {
    const Icon = () => null;
    const modules: ModuleManifest[] = [
      {
        id: "x",
        title: "X",
        icon: Icon,
        nav: [
          { path: "", label: "Open" },
          { path: "more", label: "More" },
        ],
      },
    ];
    expect(navEntries(modules).map((e) => [e.to, e.end])).toEqual([
      ["/m/x", true],
      ["/m/x/more", false],
    ]);
  });

  it("passes an item's badge hook on", () => {
    const Icon = () => null;
    const useBadge = () => 2;
    const modules: ModuleManifest[] = [
      { id: "x", title: "X", icon: Icon, nav: [{ path: "", label: "Open", useBadge }] },
    ];
    expect(navEntries(modules)[0]?.useBadge).toBe(useBadge);
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
