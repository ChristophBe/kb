import { cn } from "@kb/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { type ThemePref, useThemePref } from "./theme.ts";

const options = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const satisfies { value: ThemePref; label: string; icon: unknown }[];

/** Segmented System/Light/Dark switch. Native radios give the arrow-key behaviour. */
export function ThemeToggle() {
  const [pref, setPref] = useThemePref();
  return (
    <fieldset className="flex rounded-full bg-surface-muted p-0.5">
      <legend className="sr-only">Theme</legend>
      {options.map(({ value, label, icon: Icon }) => (
        <label
          key={value}
          title={label}
          className={cn(
            "flex h-7 flex-1 cursor-pointer items-center justify-center rounded-full text-fg-muted transition-colors hover:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            pref === value && "bg-surface text-fg shadow-glass",
          )}
        >
          <input
            type="radio"
            name="kb-theme"
            value={value}
            checked={pref === value}
            onChange={() => setPref(value)}
            className="sr-only"
          />
          <Icon className="size-4" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
