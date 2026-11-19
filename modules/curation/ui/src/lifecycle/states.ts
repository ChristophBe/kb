import { LifecycleState } from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import type { Tone } from "@knowcel/ui";

interface StateInfo {
  label: string;
  tone: Tone;
  /** What the state means, as the dialog shows it. */
  meaning: string;
}

/** The states a document can be set to, in the order the dialog lists them. */
export const STATES: { state: LifecycleState; info: StateInfo }[] = [
  {
    state: LifecycleState.DRAFT,
    info: { label: "Draft", tone: "neutral", meaning: "Still being written." },
  },
  {
    state: LifecycleState.IN_REVIEW,
    info: { label: "In review", tone: "info", meaning: "Waiting to be checked." },
  },
  {
    state: LifecycleState.APPROVED,
    info: {
      label: "Approved",
      tone: "success",
      meaning: "Checked and authoritative. It ranks higher in answers and search.",
    },
  },
  {
    state: LifecycleState.DEPRECATED,
    info: {
      label: "Deprecated",
      tone: "warning",
      meaning: "Outdated, kept for reference. It ranks much lower and is left out of chat answers.",
    },
  },
  {
    state: LifecycleState.ARCHIVED,
    info: {
      label: "Archived",
      tone: "neutral",
      meaning: "Kept for the record only. It ranks lowest and is left out of chat answers.",
    },
  },
];

const byState = new Map(STATES.map((s) => [s.state, s.info]));

/** The label and tone of a state; undefined for a state this UI doesn't know. */
export function stateInfo(state: LifecycleState): StateInfo | undefined {
  return byState.get(state);
}

/** Whether chat leaves the documents in this state out of its answers. */
export function leavesChat(state: LifecycleState): boolean {
  return state === LifecycleState.DEPRECATED || state === LifecycleState.ARCHIVED;
}
