import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, toast, useToasts } from "./toast.ts";

function current() {
  return renderHook(() => useToasts());
}

describe("toast", () => {
  afterEach(() => {
    const { result } = current();
    act(() => {
      for (const t of result.current) dismissToast(t.id);
    });
  });

  it("publishes each kind to subscribers", () => {
    const { result } = current();
    act(() => {
      toast.success("saved");
      toast.info("note");
      toast.error("failed");
    });
    expect(result.current.map((t) => [t.kind, t.message])).toEqual([
      ["success", "saved"],
      ["info", "note"],
      ["error", "failed"],
    ]);
  });

  it("keeps the three newest", () => {
    const { result } = current();
    act(() => {
      for (const n of [1, 2, 3, 4]) toast.info(`t${n}`);
    });
    expect(result.current.map((t) => t.message)).toEqual(["t2", "t3", "t4"]);
  });

  it("dismisses one toast", () => {
    const { result } = current();
    act(() => {
      toast.info("a");
      toast.info("b");
    });
    act(() => dismissToast(result.current[0]?.id ?? 0));
    expect(result.current.map((t) => t.message)).toEqual(["b"]);
  });

  it("carries an action", () => {
    const onSelect = vi.fn();
    const { result } = current();
    act(() => toast.success("deleted", { action: { label: "Undo delete", onSelect } }));
    result.current[0]?.action?.onSelect();
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
