import { CurationService } from "@knowcel/curation-api/knowcel/curation/v1/curation_pb";
import { useClient, useCurrentUser, useQuery } from "@knowcel/module-sdk";
import { Badge, Button, Card, ErrorMessage, formatTime } from "@knowcel/ui";
import { findingsError } from "../errors.ts";
import { stateInfo } from "./states.ts";
import { useUserNames } from "./useUserNames.ts";

/**
 * Every change of a document's approval state: who made it, when, and why. It
 * shows nothing for a document that never had a state.
 */
export default function LifecycleHistory({ documentId }: { documentId: string }) {
  const client = useClient(CurationService);
  const user = useCurrentUser();
  const names = useUserNames();
  const history = useQuery({
    queryKey: ["lifecycle", "history", documentId],
    queryFn: () => client.listLifecycleHistory({ documentId }),
    retry: false,
  });
  const who = (id: string) => (id === user?.id ? "you" : (names.get(id) ?? "another user"));

  if (history.isPending) return null;
  if (history.error) {
    return (
      <section aria-labelledby="lifecycle-history" className="mt-6 max-w-2xl">
        <h2 id="lifecycle-history" className="mb-2 text-sm font-medium">
          Approval history
        </h2>
        <ErrorMessage error={findingsError(history.error)} />
        <div className="mt-2">
          <Button variant="secondary" onClick={() => void history.refetch()}>
            Try again
          </Button>
        </div>
      </section>
    );
  }
  const changes = history.data.changes;
  if (changes.length === 0) return null;
  return (
    <section aria-labelledby="lifecycle-history" className="mt-6 max-w-2xl">
      <h2 id="lifecycle-history" className="mb-2 text-sm font-medium">
        Approval history
      </h2>
      <Card>
        <ol className="divide-y divide-dotted divide-border text-sm">
          {changes.map((c) => {
            const info = c.lifecycle ? stateInfo(c.lifecycle.state) : undefined;
            return (
              <li
                key={`${c.changedAt?.seconds}-${c.changedBy}-${c.lifecycle?.state}`}
                className="px-4 py-2"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {info && <Badge tone={info.tone}>{info.label}</Badge>}
                  <span className="text-fg-muted">
                    by {who(c.changedBy)} · {formatTime(c.changedAt)}
                  </span>
                </div>
                {c.note && <p className="mt-1 wrap-anywhere">{c.note}</p>}
                {c.lifecycle?.reviewBy && (
                  <p className="mt-1 text-xs text-fg-muted">
                    Review by {formatTime(c.lifecycle.reviewBy)}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
