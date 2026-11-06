/**
 * The anchor id of a heading, as GitHub derives it: lower case, punctuation
 * dropped, each space a hyphen ("Stop an answer" → "stop-an-answer"). Help page
 * anchors and the chat's manual citations both rely on this rule.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
