import { Check } from "@knowcel/ui";

export type StepState = "done" | "current" | "upcoming";

export interface Step {
  label: string;
  /** One line under the label: what to do, or what the step has done. */
  hint: string;
  state: StepState;
}

/**
 * The steps of a short flow as an ordered list. It is a status display, not a control:
 * nothing in it takes focus, and the current step carries `aria-current="step"`.
 * The steps sit side by side from `sm` up and stack on narrower screens.
 */
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="mb-4 flex flex-col gap-2 sm:flex-row sm:gap-4">
      {steps.map((step, i) => (
        <li
          key={step.label}
          aria-current={step.state === "current" ? "step" : undefined}
          className={`flex min-w-0 flex-1 items-start gap-3 rounded-card border p-3 ${step.state === "current" ? "border-accent bg-accent-subtle" : "border-border"}`}
        >
          <span
            aria-hidden="true"
            className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${step.state === "upcoming" ? "border border-border-strong text-fg-muted" : "bg-accent text-on-accent"}`}
          >
            {step.state === "done" ? <Check className="size-4" /> : i + 1}
          </span>
          <span className="min-w-0 text-sm">
            <span
              className={`block font-medium ${step.state === "upcoming" ? "text-fg-muted" : ""}`}
            >
              {step.label}
              {step.state === "done" && <span className="sr-only"> (done)</span>}
              {step.state === "upcoming" && <span className="sr-only"> (not available yet)</span>}
            </span>
            <span className="block text-fg-muted">{step.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
