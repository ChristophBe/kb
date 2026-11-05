import { describe, expect, it } from "vitest";
import { formatBytes, formatRelativeTime } from "./format.ts";

const now = Date.UTC(2026, 10, 6, 12, 0, 0);
const ago = (seconds: number) => ({ seconds: BigInt(now / 1000 - seconds) });

describe("formatRelativeTime", () => {
  it.each([
    [10, "now"],
    [5 * 60, "5 minutes ago"],
    [59 * 60, "59 minutes ago"],
    [2 * 3600, "2 hours ago"],
    [24 * 3600, "yesterday"],
    [2 * 24 * 3600, "2 days ago"],
    [14 * 24 * 3600, "2 weeks ago"],
    [65 * 24 * 3600, "2 months ago"],
    [800 * 24 * 3600, "2 years ago"],
  ])("formats %i seconds ago as %s", (seconds, expected) => {
    expect(formatRelativeTime(ago(seconds), now)).toBe(expected);
  });

  it("treats times in the future as now", () => {
    expect(formatRelativeTime(ago(-30), now)).toBe("now");
  });

  it("formats a missing timestamp as empty", () => {
    expect(formatRelativeTime(undefined, now)).toBe("");
  });
});

it("formats sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536n)).toBe("1.5 KB");
});
