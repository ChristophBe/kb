import { Access, DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { useClient, useQuery } from "@knowcel/module-sdk";

/** Who can read a document, as text: "Public", or the names of its teams. */
export function accessText(teamIds: string[], teams: { id: string; name: string }[]): string {
  if (teamIds.length === 0) return "Public";
  const names = teamIds.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean);
  return names.length > 0 ? `Team: ${names.join(", ")}` : "Team";
}

/**
 * The access of the document a finished job produced, read from the document module so it
 * survives a reload. Nothing while it loads or when the document can't be read (the
 * document module is a soft dependency, and the document may be deleted).
 */
export function JobAccess({
  documentId,
  teams,
}: {
  documentId: string;
  teams: { id: string; name: string }[];
}) {
  const client = useClient(DocumentService);
  const doc = useQuery({
    queryKey: ["documents", documentId],
    queryFn: () => client.getDocument({ id: documentId }),
    retry: false,
  });
  const d = doc.data?.document;
  if (!d) return null;
  const teamIds = d.access === Access.TEAM ? d.teamIds : [];
  return <span className="text-fg-muted">{accessText(teamIds, teams)}</span>;
}
