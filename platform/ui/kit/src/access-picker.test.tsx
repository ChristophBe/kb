import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessPicker, isValidAccess, PUBLIC_ACCESS } from "./access-picker.tsx";
import { expectNoAxeViolations } from "./testing/axe.ts";

const teams = [
  { id: "t1", name: "Platform" },
  { id: "t2", name: "Support" },
];

describe("AccessPicker", () => {
  it("preselects public and shows no teams", () => {
    render(
      <AccessPicker
        legend="Who can read"
        teams={teams}
        value={PUBLIC_ACCESS}
        onChange={() => {}}
      />,
    );
    expect((screen.getByRole("radio", { name: /Public/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("group", { name: "Teams" })).toBeNull();
  });

  it("switches to team and back", () => {
    const onChange = vi.fn();
    render(
      <AccessPicker
        legend="Who can read"
        teams={teams}
        value={PUBLIC_ACCESS}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Team/ }));
    expect(onChange).toHaveBeenCalledWith({ team: true, teamIds: [] });
  });

  it("picks teams", () => {
    const onChange = vi.fn();
    render(
      <AccessPicker
        legend="Who can read"
        teams={teams}
        value={{ team: true, teamIds: ["t1"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Support" }));
    expect(onChange).toHaveBeenCalledWith({ team: true, teamIds: ["t1", "t2"] });
    fireEvent.click(screen.getByRole("radio", { name: /Public/ }));
    expect(onChange).toHaveBeenLastCalledWith({ team: false, teamIds: [] });
  });

  it("offers only public without teams", () => {
    render(
      <AccessPicker legend="Who can read" teams={[]} value={PUBLIC_ACCESS} onChange={() => {}} />,
    );
    expect((screen.getByRole("radio", { name: /Team/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <AccessPicker
        legend="Who can read"
        teams={teams}
        value={{ team: true, teamIds: ["t1"] }}
        onChange={() => {}}
      />,
    );
    await expectNoAxeViolations(container);
  });
});

describe("isValidAccess", () => {
  it("needs a team for team access", () => {
    expect(isValidAccess(PUBLIC_ACCESS)).toBe(true);
    expect(isValidAccess({ team: true, teamIds: [] })).toBe(false);
    expect(isValidAccess({ team: true, teamIds: ["t1"] })).toBe(true);
  });
});
