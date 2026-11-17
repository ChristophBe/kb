import type { NavItem } from "@knowcel/module-sdk";

/** The count a module's `useBadge` hook reports, at the end of its sidebar entry; nothing for 0. */
export function NavBadge({ useBadge }: { useBadge: NonNullable<NavItem["useBadge"]> }) {
  const count = useBadge();
  if (count <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-medium text-on-accent">
      <span aria-hidden="true">{count}</span>
      <span className="sr-only"> {count} new</span>
    </span>
  );
}
