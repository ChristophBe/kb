/** What a deployment's branding file (docs/operations/branding.md) puts into /config.json. */
export interface Branding {
  name?: string;
  logo?: { light?: string; dark?: string };
  favicon?: string;
  colors?: { light?: BrandColors; dark?: BrandColors };
}

export interface BrandColors {
  accent: string;
  onAccent: string;
}

const DEFAULT_NAME = "Knowcelium";
const STYLE_ID = "knowcel-branding";

let current: Branding = {};

/** The branding applied by `applyBranding`; empty for the Knowcelium defaults. */
export function getBranding(): Branding {
  return current;
}

/** The product name: the branded one, else "Knowcelium". */
export function productName(): string {
  return current.name ?? DEFAULT_NAME;
}

/**
 * Colour roles derived from one accent per mode; a mode without colours keeps the theme's.
 * Hover moves away from the page (darker in light mode, lighter in dark mode).
 */
function colorRules({ light, dark }: NonNullable<Branding["colors"]>): string {
  const hover = (c: BrandColors, toward: string) =>
    `color-mix(in oklab, ${c.accent}, ${toward} 18%)`;
  const subtle = (c: BrandColors) => `color-mix(in oklab, ${c.accent} 10%, var(--color-canvas))`;
  return `:root:root {
  --color-accent: light-dark(${light?.accent ?? "var(--color-sage-700)"}, ${dark?.accent ?? "var(--color-sage-400)"});
  --color-accent-hover: light-dark(${light ? hover(light, "black") : "var(--color-sage-800)"}, ${dark ? hover(dark, "white") : "var(--color-sage-300)"});
  --color-on-accent: light-dark(${light?.onAccent ?? "var(--color-stone-25)"}, ${dark?.onAccent ?? "var(--color-sage-950)"});
  --color-accent-subtle: light-dark(${light ? subtle(light) : "var(--color-sage-50)"}, ${dark ? subtle(dark) : "var(--color-sage-900)"});
  --color-focus: var(--color-accent);
}`;
}

function setFavicon(href: string | undefined) {
  if (!href) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.removeAttribute("type");
  link.href = href;
}

/**
 * Applies a deployment's branding before the first render: the colour tokens,
 * the favicon and the tab title. `Logo` and `useDocumentTitle` read the rest.
 * Without branding the theme stays as it is.
 */
export function applyBranding(branding: Branding | undefined) {
  current = branding ?? {};
  document.getElementById(STYLE_ID)?.remove();
  if (current.colors?.light || current.colors?.dark) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = colorRules(current.colors);
    document.head.append(style);
  }
  setFavicon(current.favicon);
  if (current.name) document.title = current.name;
}
