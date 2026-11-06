import { describe, expect, it } from "vitest";
import { headingSlug } from "./slug.ts";

describe("headingSlug", () => {
  it.each([
    ["Stop an answer", "stop-an-answer"],
    ["Restrict a chat to some documents", "restrict-a-chat-to-some-documents"],
    ["What's new? (and why)", "whats-new-and-why"],
    ["Files that are not supported", "files-that-are-not-supported"],
    ["  Light / dark mode ", "light--dark-mode"],
    ["Größe ändern", "größe-ändern"],
    ["snake_case and kebab-case", "snake_case-and-kebab-case"],
  ])("%s → %s", (text, slug) => {
    expect(headingSlug(text)).toBe(slug);
  });
});
