import { type LazyModule, Slot } from "@knowcel/module-sdk";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const Icon = () => <svg aria-hidden="true" />;

// A module whose page has a slot, and one that fills it before its own code is loaded.
vi.mock("./modules.gen.ts", () => {
  const guestLoad = vi.fn(async () => ({
    default: { id: "guest", title: "Guest", icon: Icon, routes: [] },
  }));
  const modules: LazyModule[] = [
    {
      id: "host",
      title: "Host",
      icon: Icon,
      load: async () => ({
        default: {
          id: "host",
          title: "Host",
          icon: Icon,
          routes: [
            { index: true, element: <Slot name="document.detail.actions" documentId="d9" /> },
          ],
        },
      }),
    },
    {
      id: "guest",
      title: "Guest",
      icon: Icon,
      slots: [
        {
          slot: "document.detail.actions",
          load: async () => ({
            default: ({ documentId }) => <b>{`Guest action ${documentId}`}</b>,
          }),
        },
      ],
      load: guestLoad,
    },
  ];
  return { modules, guestLoad };
});

const { guestLoad } = (await import("./modules.gen.ts")) as unknown as {
  guestLoad: ReturnType<typeof vi.fn>;
};
const { App } = await import("./App.tsx");

// React only retries a suspended render that started in an awaited act().
async function renderAt(path: string, enabledModules?: string[]) {
  window.history.replaceState(null, "", path);
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<App config={{ apiBaseUrl: "http://gateway", enabledModules }} />);
  });
  return result as ReturnType<typeof render>;
}

describe("slots in the shell", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("shows what an enabled module adds to another module's page, without loading its pages", async () => {
    await renderAt("/m/host");
    expect(await screen.findByText("Guest action d9")).toBeTruthy();
    expect(guestLoad).not.toHaveBeenCalled();
  });

  it("shows nothing of a module that is not enabled", async () => {
    const { container } = await renderAt("/m/host", ["host"]);
    await screen.findByRole("main");
    expect(screen.queryByText("Guest action d9")).toBeNull();
    expect(container.textContent).not.toContain("Guest action");
  });
});
