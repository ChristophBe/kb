import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isTeamNotFound, TeamPicker } from "./team-picker.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";
import { errorInfoDetail } from "./testing/errors.ts";

/** An error shaped like a ConnectError with decoded details. */
function rejected(details: unknown[]) {
  return Object.assign(new Error("[not_found] team not found"), { details });
}

const options = [
  { id: "t1", name: "Platform" },
  { id: "t2", name: "Support", disabled: true },
];

describe("TeamPicker", () => {
  it("is a named group of checkboxes that report the selection", () => {
    const onChange = vi.fn();
    render(
      <TeamPicker
        legend="Share with"
        hint="Members can read it."
        options={options}
        selected={["t2"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("group", { name: "Share with" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Support" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("checkbox", { name: "Support" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Platform" }));
    expect(onChange).toHaveBeenCalledWith(["t2", "t1"]);
  });

  it("unchecks a team", () => {
    const onChange = vi.fn();
    render(
      <TeamPicker legend="Share with" options={options} selected={["t1"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Platform" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <TeamPicker
        legend="Share with"
        hint="Members can read it."
        options={options}
        selected={["t1"]}
        onChange={() => {}}
      />,
    );
    await expectNoAxeViolations(container);
  });
});

describe("isTeamNotFound", () => {
  it("recognises the reason, not just the code", () => {
    expect(isTeamNotFound(rejected([]))).toBe(false);
    const detail = errorInfoDetail({ reason: "TEAM_NOT_FOUND", domain: "knowcel.document.v1" });
    expect(isTeamNotFound(rejected([detail]))).toBe(true);
  });
});
