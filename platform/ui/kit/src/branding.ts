/** What a deployment's branding file (docs/operations/branding.md) puts into /config.json. */
export interface Branding {
  name?: string;
  logo?: { light?: string; dark?: string; showName?: boolean };
  favicon?: string;
  colors?: { light?: BrandColors; dark?: BrandColors };
  fonts?: { heading?: BrandFont; body?: BrandFont; mono?: BrandFont };
  navigation?: { light?: BrandNavigation; dark?: BrandNavigation };
}

/** The main sidebar of one mode: a solid color or a linear gradient, and optionally its text color. */
export interface BrandNavigation {
  background:
    | string
    | { from: string; to: string /** Degrees; 180 (top to bottom) by default. */; angle?: number };
  text?: string;
}

/** A typeface: a font file served by the deployment (else a system font) under a family name. */
export interface BrandFont {
  family: string;
  file?: string;
  /** A weight such as "400" (the default) or a range such as "100 900" for a variable font. */
  weight?: string;
}

/** Colours of one mode as `#rrggbb`; a key left out keeps the theme's colour. */
export interface BrandColors {
  accent?: string;
  onAccent?: string;
  /** The second stop of the hero gradient. */
  accent2?: string;
  canvas?: string;
  surface?: string;
  text?: string;
  textMuted?: string;
  border?: string;
  borderStrong?: string;
  /** The two background lights: a colour, or "none" to turn the light off. */
  glow1?: string;
  glow2?: string;
}

const DEFAULT_NAME = "Knowcelium";
const STYLE_ID = "knowcel-branding";

/** What follows a branded family: the Knowcelium stacks of theme.css. */
const FALLBACKS = {
  heading: {
    token: "--font-serif",
    stack: "ui-serif, Georgia, serif",
    default: '"Source Serif 4 Variable"',
  },
  body: {
    token: "--font-sans",
    stack: "ui-sans-serif, system-ui, sans-serif",
    default: '"IBM Plex Sans Variable"',
  },
  mono: {
    token: "--font-mono",
    stack: 'ui-monospace, "SF Mono", Menlo, monospace',
    default: '"IBM Plex Mono"',
  },
} as const;

let current: Branding = {};
// --- product name everywhere (#360) ---
let branded = false;
let version = "dev";

/** The branding applied by `applyBranding`; empty for the Knowcelium defaults. */
export function getBranding(): Branding {
  return current;
}

/** The product name: the branded one, else "Knowcelium". */
export function productName(): string {
  return current.name ?? DEFAULT_NAME;
}

/** Whether the deployment has a branding file (even an empty one). */
export function isBranded(): boolean {
  return branded;
}

/** The running web build's version (`version` of /config.json), "dev" for local builds. */
export function appVersion(): string {
  return version;
}

/**
 * Text with the product name written "Knowcelium" (or "knowcelium" in an eyebrow)
 * shown with the deployment's name; unchanged without branding. Possessives
 * ("Knowcelium's") follow.
 */
export function brandText(text: string): string {
  if (!current.name) return text;
  const name = current.name;
  return text.replace(/knowcelium/gi, () => name);
}

/** The roles one key sets, as [token, key, light fallback, dark fallback] with the theme's own steps. */
const COLOR_ROLES = [
  ["--color-accent-2", "accent2", "var(--color-ochre-500)", "var(--color-ochre-350)"],
  ["--color-canvas", "canvas", "var(--color-stone-100)", "var(--color-stone-900)"],
  ["--color-surface", "surface", "var(--color-stone-50)", "var(--color-stone-850)"],
  ["--color-fg", "text", "var(--color-stone-800)", "var(--color-stone-150)"],
  ["--color-fg-muted", "textMuted", "var(--color-stone-600)", "var(--color-stone-400)"],
  ["--color-border", "border", "var(--color-stone-300)", "var(--color-stone-700)"],
  ["--color-border-strong", "borderStrong", "var(--color-stone-550)", "var(--color-stone-500)"],
] as const;

/** The two background lights: the theme's literal colours (theme.css) and their opacity per mode. */
const GLOWS = [
  ["--color-glow-1", "glow1", ["rgb(66 112 84 / 0.1)", 10], ["rgb(140 200 160 / 0.1)", 10]],
  ["--color-glow-2", "glow2", ["rgb(169 116 22 / 0.1)", 10], ["rgb(238 196 105 / 0.08)", 8]],
] as const;

/** The glass fills: the theme's literal colours (theme.css) and the share of `surface` they keep. */
const GLASS = [
  ["--color-glass", "rgb(252 252 250 / 0.72)", "rgb(25 26 23 / 0.72)", 72],
  ["--color-glass-strong", "rgb(252 252 250 / 0.86)", "rgb(25 26 23 / 0.86)", 86],
  ["--color-glass-subtle", "rgb(252 252 250 / 0.4)", "rgb(25 26 23 / 0.4)", 40],
] as const;

/**
 * Colour roles of the configured keys; a mode or key left out keeps the theme's colour.
 * Derived from the accent: hover (moves away from the page, darker in light mode, lighter in
 * dark mode) and the subtle fill. Derived from the page colours: the muted surface and the glass.
 */
function colorRules({ light, dark }: NonNullable<Branding["colors"]>): string[] {
  const set = (key: keyof BrandColors) => light?.[key] !== undefined || dark?.[key] !== undefined;
  const role = (token: string, l: string, d: string) => `  ${token}: light-dark(${l}, ${d});`;
  const hover = (accent: string, toward: string) => `color-mix(in oklab, ${accent}, ${toward} 18%)`;
  const subtle = (accent: string) => `color-mix(in oklab, ${accent} 10%, var(--color-canvas))`;
  const lines: string[] = [];

  if (set("accent"))
    lines.push(
      role(
        "--color-accent",
        light?.accent ?? "var(--color-sage-700)",
        dark?.accent ?? "var(--color-sage-400)",
      ),
      role(
        "--color-accent-hover",
        light?.accent ? hover(light.accent, "black") : "var(--color-sage-800)",
        dark?.accent ? hover(dark.accent, "white") : "var(--color-sage-300)",
      ),
      role(
        "--color-accent-subtle",
        light?.accent ? subtle(light.accent) : "var(--color-sage-50)",
        dark?.accent ? subtle(dark.accent) : "var(--color-sage-900)",
      ),
    );
  if (set("onAccent"))
    lines.push(
      role(
        "--color-on-accent",
        light?.onAccent ?? "var(--color-stone-25)",
        dark?.onAccent ?? "var(--color-sage-950)",
      ),
    );
  for (const [token, key, l, d] of COLOR_ROLES)
    if (set(key)) lines.push(role(token, light?.[key] ?? l, dark?.[key] ?? d));
  if (set("surface") || set("text")) {
    // A mix of the surface and the text colour of the mode, which the theme's grey also is.
    const muted = (c: BrandColors | undefined, surface: string, text: string) =>
      c?.surface || c?.text
        ? `color-mix(in oklab, ${c.surface ?? surface}, ${c.text ?? text} 8%)`
        : undefined;
    lines.push(
      role(
        "--color-surface-muted",
        muted(light, "var(--color-stone-50)", "var(--color-stone-800)") ?? "var(--color-stone-200)",
        muted(dark, "var(--color-stone-850)", "var(--color-stone-150)") ?? "var(--color-stone-750)",
      ),
    );
  }
  for (const [token, key, l, d] of GLOWS) {
    if (!set(key)) continue;
    const lightValue = light?.[key];
    const darkValue = dark?.[key];
    const lit = (value: string, alpha: number) =>
      value === "none" ? "transparent" : `color-mix(in srgb, ${value} ${alpha}%, transparent)`;
    lines.push(
      role(
        token,
        lightValue ? lit(lightValue, l[1]) : l[0],
        darkValue ? lit(darkValue, d[1]) : d[0],
      ),
    );
  }
  lines.push("  --color-focus: var(--color-accent);");
  const rules = [`:root:root {\n${lines.join("\n")}\n}`];

  if (light?.surface || dark?.surface) {
    const glass = GLASS.map(([token, l, d, share]) => {
      const fill = (c: BrandColors | undefined, fallback: string) =>
        c?.surface ? `color-mix(in srgb, ${c.surface} ${share}%, transparent)` : fallback;
      return role(token, fill(light, l), fill(dark, d));
    });
    // Where glass cannot blur or is unwanted the theme uses the opaque surface, which follows the branding.
    rules.push(
      `@supports (backdrop-filter: blur(1px)) {\n@media not (prefers-reduced-transparency: reduce) {\n:root:root {\n${glass.join("\n")}\n}\n}\n}`,
    );
  }
  return rules;
}

/** `@font-face` rules for the font files and the family tokens, each falling back to the Knowcelium typeface. */
function fontRules(fonts: NonNullable<Branding["fonts"]>): string[] {
  const rules: string[] = [];
  const tokens: string[] = [];
  for (const [role, font] of Object.entries(fonts) as [keyof typeof FALLBACKS, BrandFont][]) {
    const family = `"${font.family.replace(/["\\]/g, "")}"`;
    if (font.file) {
      const format = font.file.endsWith(".woff2") ? "woff2" : "woff";
      rules.push(
        `@font-face { font-family: ${family}; src: url("${font.file}") format("${format}"); font-weight: ${font.weight ?? "400"}; font-display: swap; }`,
      );
    }
    const { token, default: base, stack } = FALLBACKS[role];
    tokens.push(`  ${token}: ${family}, ${base}, ${stack};`);
  }
  return [...rules, `:root:root {\n${tokens.join("\n")}\n}`];
}

// --- navigation ---
/**
 * The sidebar background as one gradient layer per mode, each transparent in the other mode
 * (`light-dark()` takes colours only, and the angles may differ); a mode without a value keeps the glass.
 */
function navigationBackground({ light, dark }: NonNullable<Branding["navigation"]>) {
  const layer = (nav: BrandNavigation | undefined, mode: "light" | "dark") => {
    if (!nav) return [];
    const { from, to, angle } =
      typeof nav.background === "string"
        ? { from: nav.background, to: nav.background, angle: 180 }
        : { ...nav.background, angle: nav.background.angle ?? 180 };
    const stop = (c: string) =>
      mode === "light" ? `light-dark(${c}, transparent)` : `light-dark(transparent, ${c})`;
    return [`linear-gradient(${angle}deg, ${stop(from)}, ${stop(to)})`];
  };
  return [...layer(light, "light"), ...layer(dark, "dark")].join(", ");
}

/**
 * The sidebar text tokens (`nav-area` in theme.css): text, icons, and the hover, active and
 * input fills tinted from the text color so they stay readable on the background.
 */
function navigationTextRules({ light, dark }: NonNullable<Branding["navigation"]>): string[] {
  const pick = (role: (text: string) => string, fallback: string) =>
    `light-dark(${light?.text ? role(light.text) : fallback}, ${dark?.text ? role(dark.text) : fallback})`;
  const tint = (pct: number, fallback: string) =>
    pick((t) => `color-mix(in oklab, ${t} ${pct}%, transparent)`, fallback);
  return [
    `--navigation-fg: light-dark(${light?.text ?? "var(--color-stone-800)"}, ${dark?.text ?? "var(--color-stone-150)"});`,
    `--navigation-fg-muted: light-dark(${light?.text ?? "var(--color-stone-600)"}, ${dark?.text ?? "var(--color-stone-400)"});`,
    `--navigation-hover: ${tint(12, "var(--color-surface-muted)")};`,
    `--navigation-active: ${tint(18, "var(--color-accent-subtle)")};`,
    `--navigation-surface: ${tint(14, "var(--color-surface)")};`,
    `--navigation-accent: light-dark(${light?.text ?? "var(--color-accent)"}, ${dark?.text ?? "var(--color-accent)"});`,
  ];
}

function navigationRules(navigation: NonNullable<Branding["navigation"]>): string {
  const declarations = [];
  if (navigation.light || navigation.dark)
    declarations.push(`--navigation-background: ${navigationBackground(navigation)};`);
  if (navigation.light?.text || navigation.dark?.text)
    declarations.push(...navigationTextRules(navigation));
  return `:root:root {\n  ${declarations.join("\n  ")}\n}`;
}
// --- end navigation ---

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
 * Applies a deployment's branding before the first render: the colour and font
 * tokens, the favicon and the tab title. `Logo` and `useDocumentTitle` read the rest;
 * `buildVersion` is the web build's version for the credit line.
 * Without branding the theme stays as it is.
 */
export function applyBranding(branding: Branding | undefined, buildVersion?: string) {
  current = branding ?? {};
  branded = branding !== undefined;
  version = buildVersion ?? "dev";
  document.getElementById(STYLE_ID)?.remove();
  const rules: string[] = [];
  if (current.colors?.light || current.colors?.dark) rules.push(...colorRules(current.colors));
  if (current.fonts && Object.keys(current.fonts).length > 0)
    rules.push(...fontRules(current.fonts));
  if (current.navigation) rules.push(navigationRules(current.navigation));
  if (rules.length > 0) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = rules.join("\n");
    document.head.append(style);
  }
  setFavicon(current.favicon);
  if (current.name) document.title = current.name;
}
