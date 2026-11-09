import { describe, expect, it, vi } from "vitest";
import { lazySearch, type SearchContext } from "./types.ts";

const signal = new AbortController().signal;
const context = {} as SearchContext;

describe("lazySearch", () => {
  it("knows its label up front and loads the search once, on the first search", async () => {
    const search = vi.fn(async (query: string) => [{ title: query, href: "/x" }]);
    const load = vi.fn(async () => search);
    const provider = lazySearch("Things", load);
    expect(provider.label).toBe("Things");
    expect(load).not.toHaveBeenCalled();

    expect(await provider.search("a", signal, context)).toEqual([{ title: "a", href: "/x" }]);
    expect(await provider.search("b", signal, context)).toEqual([{ title: "b", href: "/x" }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenLastCalledWith("b", signal, context);
  });

  it("fails the search when the code can't be loaded, and tries again on the next one", async () => {
    const load = vi
      .fn<() => Promise<() => Promise<never[]>>>()
      .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module"))
      .mockResolvedValue(async () => []);
    const provider = lazySearch("Things", load);
    await expect(provider.search("a", signal, context)).rejects.toThrow("dynamically imported");
    expect(await provider.search("a", signal, context)).toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
