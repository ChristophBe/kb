import { DocumentStatus } from "@kb/document-api/kb/document/v1/document_pb";
import type { Tone } from "@kb/ui";

export const statusLabel: Record<DocumentStatus, [string, Tone]> = {
  [DocumentStatus.UNSPECIFIED]: ["Unknown", "neutral"],
  [DocumentStatus.PENDING_UPLOAD]: ["Awaiting upload", "neutral"],
  [DocumentStatus.UPLOADED]: ["Uploaded", "info"],
  [DocumentStatus.PROCESSING]: ["Processing", "warning"],
  [DocumentStatus.READY]: ["Ready", "success"],
  [DocumentStatus.FAILED]: ["Failed", "danger"],
};
