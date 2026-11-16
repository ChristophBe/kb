import { useId } from "react";
import { type TeamOption, TeamPicker } from "./team-picker.tsx";

/** Who can read a document: everyone, or the members of the chosen teams. */
export interface AccessChoice {
  team: boolean;
  teamIds: string[];
}

/** Public, the default choice. */
export const PUBLIC_ACCESS: AccessChoice = { team: false, teamIds: [] };

/** A team choice needs at least one team. */
export function isValidAccess(choice: AccessChoice): boolean {
  return !choice.team || choice.teamIds.length > 0;
}

/**
 * The choice between public and team access, with the team picker for the
 * latter. Without teams to offer (the user is in none, or IAM is down) only
 * public is possible.
 */
export function AccessPicker({
  legend,
  teams,
  value,
  onChange,
}: {
  legend: string;
  /** The teams the user belongs to. */
  teams: TeamOption[];
  value: AccessChoice;
  onChange: (value: AccessChoice) => void;
}) {
  const name = useId();
  const noTeams = teams.length === 0;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={name}
          className="mt-0.5 size-4 accent-accent"
          checked={!value.team}
          onChange={() => onChange({ team: false, teamIds: [] })}
        />
        <span>
          Public
          <span className="block text-xs text-fg-muted">Every signed-in user can read it.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={name}
          className="mt-0.5 size-4 accent-accent"
          checked={value.team}
          disabled={noTeams}
          onChange={() => onChange({ team: true, teamIds: value.teamIds })}
        />
        <span>
          Team
          <span className="block text-xs text-fg-muted">
            {noTeams
              ? "You are not in a team, or teams are unavailable right now."
              : "Only its owner and the members of the chosen teams can read it."}
          </span>
        </span>
      </label>
      {value.team && (
        <div className="ml-6">
          <TeamPicker
            legend="Teams"
            options={teams}
            selected={value.teamIds}
            onChange={(teamIds) => onChange({ team: true, teamIds })}
          />
        </div>
      )}
    </fieldset>
  );
}
