import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as icons from "./icons.tsx";

const { iconNames, setIconOverrides, ...exports } = icons;
const components = Object.entries(exports) as [string, icons.IconComponent][];
const repoFile = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../..", path), "utf8");

const kebab = (name: string) => name.replace(/(?<=[a-z])(?=[A-Z0-9])/g, "-").toLowerCase();

afterEach(() => setIconOverrides(undefined));

describe("icons", () => {
  it("exports the icons of the UI", () => {
    expect(components.length).toBeGreaterThan(30);
  });

  it.each(components)("%s renders an svg", (_name, Icon) => {
    const { container } = render(<Icon className="size-4" />);
    expect(container.querySelector("svg.size-4")).toBeTruthy();
  });

  it("names each icon the kebab-case of its export", () => {
    expect(iconNames().sort()).toEqual(components.map(([name]) => kebab(name)).sort());
  });

  it("lists every icon name in the branding guide and in the container's check", () => {
    const guide = repoFile("docs/operations/branding.md");
    const list = guide.split("<!-- icons:start -->")[1]?.split("<!-- icons:end -->")[0] ?? "";
    const listed = [...list.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(iconNames().sort());
    const script = repoFile("deploy/docker/web/branding.sh").match(/^ICON_NAMES="(.*)"$/m)?.[1];
    expect(script?.split(" ").sort()).toEqual(iconNames().sort());
  });
});

describe("a branded icon", () => {
  it("renders a decorative span that masks the image in the text colour at the class's size", () => {
    setIconOverrides({ search: "/branding/icons/search.svg" });
    const { container } = render(<icons.Search className="size-4 text-fg" aria-hidden="true" />);
    expect(container.querySelector("svg")).toBeNull();
    const span = container.querySelector("span") as HTMLSpanElement;
    expect(span.className).toContain("size-4");
    expect(span.className).toContain("text-fg");
    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.getAttribute("style")).toContain("/branding/icons/search.svg");
    expect(span.style.backgroundColor).toBe("currentcolor");
  });

  it("applies to an icon passed around as a component", () => {
    const Icon: icons.IconComponent = icons.Menu;
    setIconOverrides({ menu: "/branding/icons/menu.svg" });
    const { container } = render(<Icon className="size-5" />);
    expect(container.querySelector("span.size-5")).toBeTruthy();
  });

  it("leaves other icons as they are", () => {
    setIconOverrides({ search: "/branding/icons/search.svg" });
    const { container } = render(<icons.Menu className="size-4" />);
    expect(container.querySelector("svg.size-4")).toBeTruthy();
  });

  it("ignores names that are not an icon and falls back when overrides are removed", () => {
    setIconOverrides({ nope: "/x.svg", search: "/branding/icons/search.svg" });
    setIconOverrides(undefined);
    const { container } = render(<icons.Search className="size-4" />);
    expect(container.querySelector("svg.size-4")).toBeTruthy();
  });

  it("cannot break out of the url", () => {
    setIconOverrides({ search: '/a"); x: url("b.svg' });
    const { container } = render(<icons.Search />);
    expect(container.querySelector("span")?.getAttribute("style")).not.toContain('"); x');
  });
});
