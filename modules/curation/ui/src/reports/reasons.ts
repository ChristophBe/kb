import { ReportReason } from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";

/** The reasons for reporting a document, in the order the dialog lists them. */
export const REASONS: { reason: ReportReason; label: string; meaning: string }[] = [
  {
    reason: ReportReason.WRONG,
    label: "Wrong",
    meaning: "It contains mistakes or misleading statements.",
  },
  { reason: ReportReason.OUTDATED, label: "Outdated", meaning: "It is no longer up to date." },
  {
    reason: ReportReason.INAPPROPRIATE,
    label: "Inappropriate",
    meaning: "It shouldn't be shared here.",
  },
  {
    reason: ReportReason.OTHER,
    label: "Other",
    meaning: "Something else; say what in the comment.",
  },
];

/** The label of a reason; undefined for one this UI doesn't know. */
export function reasonLabel(reason: ReportReason): string | undefined {
  return REASONS.find((r) => r.reason === reason)?.label;
}
