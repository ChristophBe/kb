import { describe, expect, it } from "vitest";
import { isSupported } from "./files.ts";

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
