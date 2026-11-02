import { dismissToast, toast } from "@kb/module-sdk";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "./ToastHost.tsx";

function clear() {
  // Ids only grow, so this covers every toast of a test.
  for (let id = 1; id < 1000; id++) dismissToast(id);
}

describe("ToastHost", () => {
  afterEach(() => {
    act(clear);
    vi.useRealTimers();
  });

  it("has both live regions before the first toast", () => {
    render(<ToastHost />);
    const host = screen.getByRole("region", { name: "Notifications" });
    expect(within(host).getByRole("status").childElementCount).toBe(0);
    expect(within(host).getByRole("alert").childElementCount).toBe(0);
  });

  it("announces errors as alerts and the rest politely", () => {
    render(<ToastHost />);
    act(() => {
      toast.success("Document deleted");
      toast.error("Couldn't delete");
    });
    expect(within(screen.getByRole("status")).getByText("Document deleted")).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText("Couldn't delete")).toBeTruthy();
  });

  it("dismisses success toasts after 5 s, unless hovered", () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => {
      toast.success("gone soon");
      toast.success("hovered");
    });
    const hovered = screen.getByText("hovered").parentElement as HTMLElement;
    fireEvent.mouseEnter(hovered);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("gone soon")).toBeNull();
    expect(screen.getByText("hovered")).toBeTruthy();
    fireEvent.mouseLeave(hovered);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("hovered")).toBeNull();
  });

  it("keeps errors until they are dismissed", () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => toast.error("stays"));
    act(() => vi.advanceTimersByTime(60_000));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("stays")).toBeNull();
  });

  it("runs an action and closes the toast", () => {
    const onSelect = vi.fn();
    render(<ToastHost />);
    act(() => toast.success("deleted", { action: { label: "Undo delete", onSelect } }));
    fireEvent.click(screen.getByRole("button", { name: "Undo delete" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByText("deleted")).toBeNull();
  });
});
