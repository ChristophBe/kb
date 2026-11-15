/** Dotted grid texture for section backgrounds. */
export function DotGrid({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 text-border mask-radial-from-30% mask-radial-to-75% ${className}`}
      style={{
        backgroundImage: "radial-gradient(currentColor 1.2px, transparent 1.2px)",
        backgroundSize: "22px 22px",
      }}
    />
  );
}
