import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";
import { polyfillDialog } from "./testing/dialog.ts";

describe("Dialog", () => {
  beforeAll(polyfillDialog);

  it("opens labelled by its title and has no axe violations", async () => {
    const { baseElement } = render(
      <Dialog
        open
        onClose={() => {}}
        title="Edit metadata"
        footer={<button type="button">Save</button>}
      >
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Edit metadata" })).toBeTruthy();
    await expectNoAxeViolations(baseElement);
  });

  it("reports closing, e.g. by Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} title="T" footer={null}>
        x
      </Dialog>,
    );
    (screen.getByRole("dialog") as HTMLDialogElement).close();
    expect(onClose).toHaveBeenCalledOnce();
    rerender(
      <Dialog open={false} onClose={onClose} title="T" footer={null}>
        x
      </Dialog>,
    );
    expect(screen.queryByText("x")).toBeNull();
  });

  it("ignores a close event that arrives after it was reopened", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T" footer={null}>
        x
      </Dialog>,
    );
    // The browser queues the event of an earlier close; by then the dialog is open again.
    screen.getByRole("dialog").dispatchEvent(new Event("close"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
