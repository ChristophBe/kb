import { describe, expect, it } from "vitest";
import { isSupported, sha256 } from "./files.ts";

describe("isSupported", () => {
  it.each([
    ["report.pdf", ""],
    ["scan", "application/pdf"],
    ["notes.MD", ""],
    ["data.csv", ""],
    ["page", "text/html"],
  ])("accepts %s (%s)", (name, type) => {
    expect(isSupported({ name, type })).toBe(true);
  });

  it.each([
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["photo.png", "image/png"],
    ["archive", ""],
  ])("rejects %s (%s)", (name, type) => {
    expect(isSupported({ name, type })).toBe(false);
  });
});

describe("sha256", () => {
  it("hashes the file's bytes to hex", async () => {
    expect(await sha256(new File(["content"], "a.md"))).toBe(
      "ed7002b439e9ac845f22357d822bac1444730fbdb6016d3ec9432297b9ec9f73",
    );
  });
});
