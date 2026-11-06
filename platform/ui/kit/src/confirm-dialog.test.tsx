import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";
import { polyfillDialog } from "./testing/dialog.ts";

function Harness({ onConfirm = () => {}, pending = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete
      </button>
      <ConfirmDialog
        open={open}
        title="Delete document?"
        confirmLabel="Delete for good"
        pending={pending}
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      >
        It can't be undone.
      </ConfirmDialog>
    </>
  );
}

function open() {
  const opener = screen.getByRole("button", { name: "Delete" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("ConfirmDialog", () => {
  beforeAll(polyfillDialog);

  it("asks with a title, a message and both actions, and has no axe violations", async () => {
    const { baseElement } = render(<Harness />);
    open();
    const dialog = screen.getByRole("dialog", { name: "Delete document?" });
    expect(dialog.textContent).toContain("It can't be undone.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete for good" })).toBeTruthy();
    await expectNoAxeViolations(baseElement);
  });

  it("confirms", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels and returns the focus to the opener", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const opener = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("moves the focus to the fallback when the opener is gone", () => {
    function Removing() {
      const [state, setState] = useState<"idle" | "asking" | "deleted">("idle");
      const list = useRef<HTMLUListElement>(null);
      return (
        <>
          <ul ref={list} tabIndex={-1} aria-label="Items">
            {state !== "deleted" && (
              <li>
                <button type="button" onClick={() => setState("asking")}>
                  Delete
                </button>
              </li>
            )}
          </ul>
          <ConfirmDialog
            open={state === "asking"}
            title="Delete?"
            confirmLabel="Delete for good"
            onConfirm={() => setState("deleted")}
            onCancel={() => setState("idle")}
            fallbackFocus={list}
          >
            Gone for good.
          </ConfirmDialog>
        </>
      );
    }
    render(<Removing />);
    // Closed from the start, it leaves the focus alone.
    expect(document.activeElement).toBe(document.body);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(document.activeElement).toBe(screen.getByRole("list", { name: "Items" }));
  });

  it("cancels on Escape", () => {
    render(<Harness />);
    open();
    // The browser closes a modal dialog on Escape.
    (screen.getByRole("dialog") as HTMLDialogElement).close();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables both actions while pending", () => {
    render(<Harness pending />);
    open();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Delete for good" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
