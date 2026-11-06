import { expect, it } from "vitest";
import { formatBytes, formatTime } from "./format.ts";

it("formats times", () => {
  expect(formatTime(undefined)).toBe("");
  expect(formatTime({ seconds: 1_700_000_000n })).toBe(
    new Date(1_700_000_000_000).toLocaleString(),
  );
});

it("formats sizes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536n)).toBe("1.5 KB");
});
