import { describe, expect, it } from "vitest";
import { activeModules } from "./registry.ts";

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
