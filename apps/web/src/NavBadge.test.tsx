import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavBadge } from "./NavBadge.tsx";

describe("NavBadge", () => {
  it("shows the count the hook reports, with a text for screen readers", () => {
    render(<NavBadge useBadge={() => 3} />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("3 new").className).toContain("sr-only");
  });

  it("shows nothing for 0", () => {
    const { container } = render(<NavBadge useBadge={() => 0} />);
    expect(container.textContent).toBe("");
  });
});
