import { describe, expect, it } from "vitest";
import { activeModules, navEntries } from "./registry.ts";

const ids = (enabledModules?: string[]) =>
  activeModules({ apiBaseUrl: "", enabledModules }).map((m) => m.id);

describe("activeModules", () => {
  it("shows every compiled-in module when the config names none", () => {
    expect(ids()).toEqual(["chat", "document", "ingestion", "llm"]);
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
      ["Search", "/m/document/search", false],
      ["Ingestion", "/m/ingestion", true],
      ["Models", "/m/llm", true],
    ]);
  });
});
