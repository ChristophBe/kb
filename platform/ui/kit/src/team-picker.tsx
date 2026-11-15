import { useId } from "react";
import { errorInfo } from "./errors.ts";

/** A team a document can be shared with. */
export interface TeamOption {
  id: string;
  name: string;
  /** Shown as it is, but not changeable: a team the user may not stop sharing with. */
  disabled?: boolean;
}

/**
 * Checkboxes for choosing teams. A fieldset, so a screen reader announces the
 * group's name with each team.
 */
export function TeamPicker({
  legend,
  hint,
  options,
  selected,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: TeamOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const hintId = useId();
  return (
    <fieldset aria-describedby={hint ? hintId : undefined}>
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs text-fg-muted">
          {hint}
        </p>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((team) => (
          <li key={team.id}>
            <label className="flex min-h-6 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={selected.includes(team.id)}
                disabled={team.disabled}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, team.id]
                      : selected.filter((id) => id !== team.id),
                  )
                }
              />
              {team.name}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * Whether a request failed because a team isn't known to the module that checks
 * it. That is also what happens for up to half a minute after the user created
 * or joined a team, until the module has learned about it.
 */
export function isTeamNotFound(err: unknown): boolean {
  return errorInfo(err)?.reason === "TEAM_NOT_FOUND";
}

/** What `isTeamNotFound` means for the user. */
export const TEAM_NOT_FOUND_MESSAGE =
  "One of the teams isn't available. A team you created or joined a moment ago can take up to half a minute to work here; try again shortly. Otherwise you may have left the team.";
