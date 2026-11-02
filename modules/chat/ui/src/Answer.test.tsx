import { create } from "@bufbuild/protobuf";
import { type Citation, CitationSchema } from "@kb/chat-api/kb/chat/v1/chat_pb";
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

  it("links markers to the source document", () => {
    renderAnswer("Revenue grew [1], costs fell [2].", sources);
    const marker = screen.getByRole("link", { name: "Source 1: Report.pdf, chunk 3" });
    expect(marker.getAttribute("href")).toBe("/m/document/d1");
    expect(marker.textContent).toBe("[1]");
    expect(screen.getByRole("link", { name: "Source 2: Notes.md, chunk 0" })).toBeTruthy();
  });

  it("links the margin notes to the source document", () => {
    renderAnswer("No markers.", sources);
    const notes = within(screen.getByRole("list", { name: "Sources" }));
    const link = notes.getByRole("link", { name: "Report.pdf, chunk 3" });
    expect(link.getAttribute("href")).toBe("/m/document/d1");
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
    const marker = screen.getByRole("link", { name: /^Source 1/ });
    const note = screen.getByRole("link", { name: "Report.pdf, chunk 3" }).closest("li");
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
});
