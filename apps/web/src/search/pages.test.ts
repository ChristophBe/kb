import type { KbModule, SearchContext } from "@kb/module-sdk";
import { describe, expect, it } from "vitest";
import { pagesProvider, searchProviders } from "./pages.ts";

const Icon = () => null;
const document: KbModule = {
  id: "document",
  title: "Documents",
  icon: Icon,
  routes: [],
  nav: [
    { path: "", label: "Documents" },
    { path: "upload", label: "Upload" },
  ],
};
const chat: KbModule = { id: "chat", title: "Chat", icon: Icon, routes: [] };
const context = {} as SearchContext;
const signal = new AbortController().signal;

describe("pagesProvider", () => {
  const pages = pagesProvider([document, chat]);

  it("matches page labels, ignoring case, with prefix matches first", async () => {
    expect(await pages.search("CHAT", signal, context)).toEqual([
      { title: "Chat", href: "/m/chat" },
    ]);
    expect((await pages.search("h", signal, context)).map((h) => h.title)).toEqual([
      "Home",
      "Help",
      "Search",
      "Chat",
    ]);
  });

  it("names the area of a page whose label differs from its module's", async () => {
    expect(await pages.search("upl", signal, context)).toEqual([
      { title: "Upload", snippet: "Documents", href: "/m/document/upload" },
    ]);
  });

  it("lists the search page", async () => {
    expect(await pages.search("search", signal, context)).toEqual([
      { title: "Search", href: "/search" },
    ]);
  });
});

describe("searchProviders", () => {
  it("puts Pages first, then the modules that provide a search, then Help", () => {
    const provider = { label: "Conversations", search: async () => [] };
    expect(searchProviders([document, { ...chat, search: provider }]).map((p) => p.label)).toEqual([
      "Pages",
      "Conversations",
      "Help",
    ]);
  });
});
