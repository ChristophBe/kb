import { describe, expect, it } from "vitest";
import { formatBytes, formatRelativeTime, formatTime } from "./format.ts";

const at = (ms: number) => ({ seconds: BigInt(Math.floor(ms / 1000)) });
const now = Date.UTC(2026, 10, 5, 12);

describe("formatRelativeTime", () => {
  it.each([
    [now - 5_000, "5 sec. ago"],
    [now - 5 * 60_000, "5 min. ago"],
    [now - 3 * 3_600_000, "3 hr. ago"],
    [now - 86_400_000, "yesterday"],
    [now - 14 * 86_400_000, "2 wk. ago"],
    [now - 400 * 86_400_000, "last yr."],
  ])("formats %d", (ms, expected) => {
    expect(formatRelativeTime(at(ms), now)).toBe(expected);
  });

  it("is empty without a timestamp", () => {
    expect(formatRelativeTime(undefined)).toBe("");
    expect(formatTime(undefined)).toBe("");
  });
});

it("formats sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536n)).toBe("1.5 KB");
});
