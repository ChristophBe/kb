import type { AxeResults } from "axe-core";
import { expect } from "vitest";
import { configureAxe } from "vitest-axe";

// Components are rendered in isolation, so page-level rules don't apply, and
// jsdom can't compute colours: contrast is checked on the tokens instead
// (theme.test.ts).
const axe = configureAxe({
  rules: {
    region: { enabled: false },
    "color-contrast": { enabled: false },
  },
});

function describeViolations(results: AxeResults): string[] {
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${v.help} (${n.target.join(" ")})`),
  );
}

/** Fails the test with a readable list if axe finds violations in `container`. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  expect(describeViolations(await axe(container))).toEqual([]);
}
