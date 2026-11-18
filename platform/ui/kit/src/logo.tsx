import { getBranding, productName } from "./branding.ts";
import { cn } from "./cn.ts";

/** The largest size, in px, at which the small cut is used. */
const SMALL_CUT_MAX = 24;

const FULL_CUT = (
  <>
    <path d="M18.23 24C15.7 18.05 15.7 12.95 18.23 7L11.77 7C14.3 12.95 14.3 18.05 11.77 24Z" />
    <path d="M11.77 24C14.3 29.95 14.3 35.05 11.77 41L18.23 41C15.7 35.05 15.7 29.95 18.23 24Z" />
    <path d="M17.08 26.47C20.42 20.35 29.48 12.72 36.08 10.47L31.92 5.53C28.58 11.65 19.52 19.28 12.92 21.53Z" />
    <path d="M12.92 26.47C19.52 28.72 28.58 36.35 31.92 42.47L36.08 37.53C29.48 35.28 20.42 27.65 17.08 21.53Z" />
    <circle cx="15" cy="24" r="3.4" />
    <circle cx="34" cy="8" r="3.4" />
    <circle cx="34" cy="40" r="3.4" />
    <circle cx="15" cy="7" r="3.4" />
    <circle cx="15" cy="41" r="3.4" />
  </>
);

const SMALL_CUT = (
  <>
    <path d="M19.18 24C16.5 18.05 16.5 12.95 18.8 7L11.2 7C13.5 12.95 13.5 18.05 10.82 24Z" />
    <path d="M10.82 24C13.5 29.95 13.5 35.05 11.2 41L18.8 41C16.5 35.05 16.5 29.95 19.18 24Z" />
    <path d="M17.69 27.2C20.94 20.96 29.99 13.33 36.45 10.91L31.55 5.09C28.06 11.04 19.01 18.67 12.31 20.8Z" />
    <path d="M12.31 27.2C19.01 29.33 28.06 36.96 31.55 42.91L36.45 37.09C29.99 34.67 20.94 27.04 17.69 20.8Z" />
    <circle cx="15" cy="24" r="4.4" />
    <circle cx="34" cy="8" r="4" />
    <circle cx="34" cy="40" r="4" />
    <circle cx="15" cy="7" r="4" />
    <circle cx="15" cy="41" r="4" />
  </>
);

/**
 * The Knowcelium mark, a k drawn as a graph. Single colour (`currentColor`,
 * so `text-accent` colours it); the small cut is used at 24px and below. It is
 * decorative unless given a `label`.
 */
export function Mark({
  size = 24,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="currentColor"
      className={cn("shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <title>{label ?? productName()}</title>
      {size <= SMALL_CUT_MAX ? SMALL_CUT : FULL_CUT}
    </svg>
  );
}

/**
 * The lockup: the mark in the accent colour, then "knowcelium". `size` is the
 * mark's size in px; the wordmark scales with it (the mark is about 1.4 times
 * the cap height). A deployment's branding replaces it: its logo image (the
 * one for the current light or dark mode), else its product name as text.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  const { logo, name } = getBranding();
  const either = logo?.light ?? logo?.dark;
  if (logo && either) {
    const height = Math.round(size * 1.4);
    const image = (src: string, mode?: "light" | "dark") => (
      <img
        key={mode ?? "both"}
        src={src}
        alt={productName()}
        height={height}
        className={cn("w-auto max-w-full", mode && `brand-logo-${mode}`)}
        style={{ height }}
      />
    );
    const light = logo.light ?? either;
    const dark = logo.dark ?? either;
    return (
      <span className={cn("inline-flex items-center", className)}>
        {/* One image serves both modes; two are switched by theme.css. */}
        {light === dark ? image(light) : [image(light, "light"), image(dark, "dark")]}
      </span>
    );
  }
  if (name) {
    return (
      <span
        className={cn("inline-flex items-center font-semibold tracking-tight", className)}
        style={{ fontSize: size }}
      >
        <span style={{ lineHeight: 1 }}>{name}</span>
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center font-semibold tracking-tight", className)}
      style={{ fontSize: size, gap: "0.3em" }}
    >
      <Mark size={size} className="text-accent" />
      <span style={{ lineHeight: 1 }}>knowcelium</span>
    </span>
  );
}
