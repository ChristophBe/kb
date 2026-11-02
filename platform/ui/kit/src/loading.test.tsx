import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelayedLoading, Skeleton, SkeletonRows } from "./loading.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";

describe("loading components", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Skeleton is hidden from assistive technology", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("SkeletonRows announces what is loading", async () => {
    const { container } = render(<SkeletonRows label="Loading documents" />);
    expect(screen.getByText("Loading documents")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    await expectNoAxeViolations(container);
  });

  it("DelayedLoading shows its children only after the delay", () => {
    vi.useFakeTimers();
    render(<DelayedLoading delay={300}>loading</DelayedLoading>);
    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByText("loading")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("loading")).toBeTruthy();
  });
});
