import { create } from "@bufbuild/protobuf";
import { type Citation, CitationSchema } from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import { defineManifest, SlotsProvider } from "@knowcel/module-sdk";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Answer } from "./Answer.tsx";

const citation = (documentId: string, documentTitle: string, chunkIndex: number) =>
  create(CitationSchema, { documentId, documentTitle, chunkIndex, snippet: "a snippet" });

const sources = [citation("d1", "Report.pdf", 3), citation("d2", "Notes.md", 0)];

function renderAnswer(content: string, citations: Citation[] = []) {
  return render(
    <MemoryRouter>
      <Answer content={content} citations={citations} />
    </MemoryRouter>,
  );
}

describe("Answer", () => {
  it("renders lists, tables and code blocks", () => {
    const { container } = renderAnswer(
      "# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```py\nprint('x')\n```",
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toContain("print('x')");
  });

  it("renders incomplete Markdown while it streams", () => {
    const { rerender, container } = renderAnswer("Some **bo");
    expect(container.textContent).toContain("Some **bo");

    rerender(
      <MemoryRouter>
        <Answer content={"```py\nprint("} citations={[]} />
      </MemoryRouter>,
    );
    expect(container.querySelector("pre code")?.textContent).toContain("print(");

    rerender(
      <MemoryRouter>
        <Answer content={"- one\n- tw"} citations={[]} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not execute raw HTML", () => {
    const onerror = vi.fn();
    vi.stubGlobal("pwned", onerror);
    const { container } = renderAnswer(
      '<script>window.pwned()</script>\n\n<img src=x onerror="window.pwned()">\n\n<b>bold</b>',
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(onerror).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("removes script URLs from links and images", () => {
    const { container } = renderAnswer(
      "[click](javascript:alert(1)) ![x](javascript:alert(1)) [ok](https://example.com)",
    );
    expect(container.innerHTML).not.toContain("javascript:");
    expect(screen.getByRole("link", { name: "ok" }).getAttribute("rel")).toBe("noreferrer");
  });

  it("links markers to the source passage, numbered from 1 as in search", () => {
    renderAnswer("Revenue grew [1], costs fell [2].", sources);
    const marker = screen.getByRole("link", { name: "Source 1: Report.pdf, passage 4" });
    expect(marker.getAttribute("href")).toBe("/m/document/d1#chunk-3");
    expect(marker.textContent).toBe("[1]");
    expect(screen.getByRole("link", { name: "Source 2: Notes.md, passage 1" })).toBeTruthy();
  });

  it("lists the documents of an answer in a collapsed section", () => {
    renderAnswer("No markers.", [...sources, citation("d1", "Report.pdf", 5)]);
    const list = within(screen.getByRole("list", { name: "Sources" }));
    const report = list.getByRole("button", { name: /Report\.pdf/ });
    expect(report.textContent).toContain("2 passages");
    expect(report.getAttribute("aria-expanded")).toBe("false");
    expect(list.getByRole("button", { name: /Notes\.md/ }).textContent).toContain("1 passage");
    expect(list.getAllByRole("button")).toHaveLength(2);
    // Collapsed: the passages are not offered.
    expect(list.queryByRole("link")).toBeNull();
  });

  it("shows the passages of an expanded document and links them", () => {
    renderAnswer("No markers.", sources);
    const list = within(screen.getByRole("list", { name: "Sources" }));
    const report = list.getByRole("button", { name: /Report\.pdf/ });
    fireEvent.click(report);
    expect(report.getAttribute("aria-expanded")).toBe("true");
    const link = list.getByRole("link", { name: "Report.pdf, passage 4" });
    expect(link.getAttribute("href")).toBe("/m/document/d1#chunk-3");
    expect(link.closest("li")?.textContent).toContain("a snippet");
    expect(list.queryByRole("link", { name: "Notes.md, passage 1" })).toBeNull();
    fireEvent.click(report);
    expect(list.queryByRole("link")).toBeNull();
  });

  it("groups the user manual sections as one entry marked user manual", () => {
    const manual = create(CitationSchema, {
      documentTitle: "Chat: Stop an answer",
      snippet: "Select Stop.",
      manualPage: "chat",
      manualSection: "stop-an-answer",
    });
    renderAnswer("Select Stop [1], see also [2].", [manual, ...sources]);

    const list = within(screen.getByRole("list", { name: "Sources" }));
    const entry = list.getByRole("button", { name: /User manual/ });
    expect(entry.textContent).toContain("1 section");
    fireEvent.click(entry);
    const note = list.getByRole("link", { name: "Chat: Stop an answer, user manual" });
    expect(note.getAttribute("href")).toBe("/help/chat#stop-an-answer");
    expect(list.getByText("user manual")).toBeTruthy();
    const marker = screen.getByRole("link", {
      name: "Source 1: Chat: Stop an answer, user manual",
    });
    expect(marker.getAttribute("href")).toBe("/help/chat#stop-an-answer");
  });

  it("lists an answer that cites only the user manual with that entry", () => {
    const manual = create(CitationSchema, {
      documentTitle: "Chat: Stop an answer",
      manualPage: "chat",
      manualSection: "stop-an-answer",
    });
    renderAnswer("Select Stop [1].", [manual]);
    const list = within(screen.getByRole("list", { name: "Sources" }));
    expect(list.getAllByRole("button")).toHaveLength(1);
    expect(list.getByRole("button", { name: /User manual/ })).toBeTruthy();
  });

  it("expands the document of a selected marker", () => {
    renderAnswer("Costs fell [2].", sources);
    const list = within(screen.getByRole("list", { name: "Sources" }));
    const notes = list.getByRole("button", { name: /Notes\.md/ });
    expect(notes.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("link", { name: /^Source 2/ }));
    expect(notes.getAttribute("aria-expanded")).toBe("true");
    expect(list.getByRole("link", { name: "Notes.md, passage 1" })).toBeTruthy();
    expect(list.getByRole("button", { name: /Report\.pdf/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("shows no sources section without sources or while the answer streams", () => {
    const { rerender } = renderAnswer("No sources.");
    expect(screen.queryByRole("list", { name: "Sources" })).toBeNull();
    rerender(
      <MemoryRouter>
        <Answer content="Fact [1]." citations={sources} streaming />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("list", { name: "Sources" })).toBeNull();
    // The markers already link to their passage.
    expect(screen.getByRole("link", { name: /^Source 1/ })).toBeTruthy();
  });

  it("leaves markers in code and without a source as text", () => {
    const { container } = renderAnswer("Array `a[1]` and [7].\n\n```\nb[2]\n```", sources);
    expect(screen.queryByRole("link", { name: /^Source/ })).toBeNull();
    expect(container.textContent).toContain("a[1]");
    expect(container.textContent).toContain("[7]");
  });

  it("does not nest a marker inside a link", () => {
    renderAnswer("[see [1] here](https://example.com)", sources);
    expect(screen.queryByRole("link", { name: /^Source/ })).toBeNull();
  });

  it("highlights the note of a hovered or focused marker", () => {
    renderAnswer("Fact [1].", sources);
    fireEvent.click(screen.getByRole("button", { name: /Report\.pdf/ }));
    const marker = screen.getByRole("link", { name: /^Source 1/ });
    const note = screen.getByRole("link", { name: "Report.pdf, passage 4" }).closest("li");
    expect(note?.className).not.toContain("border-accent");
    fireEvent.mouseEnter(marker);
    expect(note?.className).toContain("border-accent");
    fireEvent.mouseLeave(marker);
    expect(note?.className).not.toContain("border-accent");
    fireEvent.focus(marker);
    expect(note?.className).toContain("border-accent");
  });

  it("copies a code block", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderAnswer("```\ncode here\n```");
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("code here\n");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("lets other modules add actions to a source that is a document, with its details", async () => {
    const rate = defineManifest({
      id: "curation",
      title: "Curation",
      icon: () => null,
      slots: [
        {
          slot: "chat.citation.actions",
          load: async () => ({
            default: ({ documentId, chunkIndex, conversationId }) => (
              <button type="button">{`Rate ${documentId}/${chunkIndex}/${conversationId}`}</button>
            ),
          }),
        },
      ],
    });
    render(
      <SlotsProvider modules={[rate]}>
        <MemoryRouter>
          <Answer
            content="See [1] and [2]."
            citations={[
              ...sources,
              create(CitationSchema, {
                documentTitle: "Help",
                manualPage: "chat",
                manualSection: "ask",
              }),
            ]}
            conversationId="c1"
          />
        </MemoryRouter>
      </SlotsProvider>,
    );
    for (const name of [/Report\.pdf/, /Notes\.md/, /User manual/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(await screen.findByRole("button", { name: "Rate d1/3/c1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rate d2/0/c1" })).toBeTruthy();
    // The user manual has no document to act on.
    expect(screen.getAllByRole("button", { name: /^Rate / })).toHaveLength(2);
  });

  it("leaves the sources as they are without a module that fills the slot", () => {
    const { container } = renderAnswer("See [1].", sources);
    // The row for actions stays empty, and is hidden by its empty: style.
    const rows = container.querySelectorAll("ul[aria-label='Sources'] li > div");
    expect([...rows].every((row) => row.innerHTML === "")).toBe(true);
    expect([...rows].every((row) => row.className.includes("empty:hidden"))).toBe(true);
  });
});
