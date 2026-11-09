import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "./testing/axe.ts";
import { Widget, WidgetMessage } from "./widget.tsx";

const Icon = ({ className }: { className?: string }) => <svg className={className} />;

describe("Widget", () => {
  it("has a heading, an action and the content", async () => {
    const { container } = render(
      <Widget title="Recent documents" icon={Icon} action={<a href="/m/document">All</a>}>
        <p>content</p>
      </Widget>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Recent documents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All" })).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
    expect(
      container.querySelector("svg")?.closest("[aria-hidden]")?.getAttribute("aria-hidden"),
    ).toBe("true");
    await expectNoAxeViolations(container);
  });
});

describe("WidgetMessage", () => {
  it("shows a message without a retry button by default", () => {
    render(<WidgetMessage>Nothing here yet.</WidgetMessage>);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers to try again", async () => {
    const onRetry = vi.fn();
    const { container } = render(
      <WidgetMessage onRetry={onRetry}>Can't be loaded right now.</WidgetMessage>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    await expectNoAxeViolations(container);
  });
});
