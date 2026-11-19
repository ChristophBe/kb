import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as icons from "./icons.tsx";

const components = Object.entries(icons) as [string, icons.IconComponent][];

describe("icons", () => {
  it("exports the icons of the UI", () => {
    expect(components.length).toBeGreaterThan(30);
  });

  it.each(components)("%s renders an svg", (_name, Icon) => {
    const { container } = render(<Icon className="size-4" />);
    expect(container.querySelector("svg.size-4")).toBeTruthy();
  });
});
