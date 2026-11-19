import { LifecycleState } from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { Badge } from "@knowcel/ui";
import { stateInfo } from "./states.ts";
import { useDocumentState } from "./useLifecycle.ts";

/**
 * The approval state of a document as text, next to its other badges. It shows
 * nothing for a document without a state, and while the state loads or can't
 * be loaded, since the page works without it.
 */
export default function LifecycleBadge({ documentId }: { documentId: string }) {
  const state = useDocumentState(documentId).data?.lifecycle?.state ?? LifecycleState.UNSPECIFIED;
  const info = stateInfo(state);
  return info ? <Badge tone={info.tone}>{info.label}</Badge> : null;
}
