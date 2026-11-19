import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Slot, SlotsProvider } from "./slots.tsx";
import { defineManifest, type SlotContribution } from "./types.ts";
import { type CurrentUser, CurrentUserProvider } from "./user.tsx";

const Icon = () => null;

type DocumentLoad = Extract<SlotContribution, { slot: "document.detail.actions" }>["load"];

function action(text: string): DocumentLoad {
  return async () => ({
    default: ({ documentId }: { documentId: string }) => <b>{`${text} ${documentId}`}</b>,
  });
}

function manifest(id: string, slots: SlotContribution[]) {
  return defineManifest({ id, title: id, icon: Icon, slots });
}

function renderSlot(
  modules: ReturnType<typeof manifest>[],
  wrap?: (children: ReactNode) => ReactNode,
) {
  const slot = <Slot name="document.detail.actions" documentId="d1" />;
  return render(<SlotsProvider modules={modules}>{wrap ? wrap(slot) : slot}</SlotsProvider>);
}

const admin: CurrentUser = { id: "a", email: "a@x", displayName: "A", platformAdmin: true };

describe("Slot", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders what a module adds, with the slot's props", async () => {
    renderSlot([
      manifest("curation", [{ slot: "document.detail.actions", load: action("Report") }]),
    ]);
    expect(await screen.findByText("Report d1")).toBeTruthy();
  });

  it("renders nothing for an empty slot, also without a provider", () => {
    const empty = render(<Slot name="document.detail.actions" documentId="d1" />);
    expect(empty.container.innerHTML).toBe("");
    const other = renderSlot([
      manifest("chat", [
        { slot: "chat.citation.actions", load: async () => ({ default: () => <b>nope</b> }) },
      ]),
      manifest("plain", []),
    ]);
    expect(other.container.innerHTML).toBe("");
  });

  it("shows only the contributions to its own slot", async () => {
    renderSlot([
      manifest("a", [
        { slot: "chat.citation.actions", load: async () => ({ default: () => <b>citation</b> }) },
        { slot: "document.detail.actions", load: action("Document") },
      ]),
    ]);
    expect(await screen.findByText("Document d1")).toBeTruthy();
    expect(screen.queryByText("citation")).toBeNull();
  });

  it("orders contributions by their order, then by module order", async () => {
    const { container } = renderSlot([
      manifest("first", [{ slot: "document.detail.actions", load: action("A") }]),
      manifest("second", [
        { slot: "document.detail.actions", load: action("B"), order: 2 },
        { slot: "document.detail.actions", load: action("C"), order: 1 },
      ]),
      manifest("third", [{ slot: "document.detail.actions", load: action("D") }]),
    ]);
    await screen.findByText("D d1");
    expect([...container.querySelectorAll("b")].map((b) => b.textContent)).toEqual([
      "C d1",
      "B d1",
      "A d1",
      "D d1",
    ]);
  });

  it("shows a contribution that requires a platform admin only to one", async () => {
    const modules = [
      manifest("curation", [
        { slot: "document.detail.actions", load: action("Admin"), requiresPlatformAdmin: true },
        { slot: "document.detail.actions", load: action("Everyone") },
      ]),
    ];
    const asUser = renderSlot(modules, (slot) => (
      <CurrentUserProvider user={{ ...admin, platformAdmin: false }}>{slot}</CurrentUserProvider>
    ));
    expect(await screen.findByText("Everyone d1")).toBeTruthy();
    expect(screen.queryByText("Admin d1")).toBeNull();
    asUser.unmount();
    renderSlot(modules, (slot) => <CurrentUserProvider user={admin}>{slot}</CurrentUserProvider>);
    expect(await screen.findByText("Admin d1")).toBeTruthy();
  });

  it("contains a contribution that throws while rendering", async () => {
    const Broken = () => {
      throw new Error("boom");
    };
    renderSlot([
      manifest("broken", [
        { slot: "document.detail.actions", load: async () => ({ default: Broken }) },
        { slot: "document.detail.actions", load: action("Fine") },
      ]),
    ]);
    expect(await screen.findByText("Fine d1")).toBeTruthy();
    expect(console.error).toHaveBeenCalled();
  });

  it("contains a contribution that fails to load, and loads it again on the next visit", async () => {
    const load = vi
      .fn<DocumentLoad>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockImplementation(action("Back"));
    const modules = [
      manifest("flaky", [
        { slot: "document.detail.actions", load },
        { slot: "document.detail.actions", load: action("Fine") },
      ]),
    ];
    const first = renderSlot(modules);
    expect(await screen.findByText("Fine d1")).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByText("Back d1")).toBeNull();
    first.unmount();

    renderSlot(modules);
    expect(await screen.findByText("Back d1")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("tries a contribution that failed again when the page shows another document", async () => {
    const load = vi
      .fn<DocumentLoad>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockImplementation(action("Back"));
    const modules = [manifest("flaky", [{ slot: "document.detail.actions", load }])];
    const view = (id: string) => (
      <SlotsProvider modules={modules}>
        <Slot name="document.detail.actions" documentId={id} />
      </SlotsProvider>
    );
    const { rerender } = render(view("d1"));
    await act(async () => {});
    expect(screen.queryByText("Back d1")).toBeNull();
    rerender(view("d2"));
    expect(await screen.findByText("Back d2")).toBeTruthy();
  });

  it("loads a contribution once, however often the slot renders", async () => {
    const load = vi.fn<DocumentLoad>().mockImplementation(action("Once"));
    const modules = [manifest("once", [{ slot: "document.detail.actions", load }])];
    const first = renderSlot(modules);
    await screen.findByText("Once d1");
    first.unmount();
    renderSlot(modules);
    await screen.findByText("Once d1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("types the slot's props and names", () => {
    // Not rendered: this only has to compile.
    const typed = () => (
      <>
        <Slot name="document.detail.actions" documentId="d1" />
        <Slot name="chat.citation.actions" documentId="d1" chunkIndex={2} />
        {/* @ts-expect-error documentId is required */}
        <Slot name="document.detail.actions" />
        {/* @ts-expect-error there is no such slot */}
        <Slot name="nowhere" />
      </>
    );
    expect(typed).toBeTypeOf("function");
    manifest("typed", [
      {
        slot: "document.detail.actions",
        // @ts-expect-error the component must accept the slot's props
        load: async () => ({ default: ({ x }: { x: string }) => <i>{x}</i> }),
      },
    ]);
  });
});
