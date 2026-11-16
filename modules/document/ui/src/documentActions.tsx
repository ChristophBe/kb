import { DocumentService } from "@knowcel/document-api/knowcel/document/v1/document_pb";
import { toast, useClient, useMutation, useQueryClient } from "@knowcel/module-sdk";
import { ConfirmDialog } from "@knowcel/ui";
import type { RefObject } from "react";

/** Opens the original file of a document in a new tab. Shared by the list and the detail page. */
export function useDownloadDocument() {
  const client = useClient(DocumentService);
  return async (id: string) => {
    try {
      const { url } = await client.getDownloadUrl({ id });
      window.open(url, "_blank");
    } catch {
      toast.error("The download couldn't be started. Try again.");
    }
  };
}

/**
 * The confirmation for deleting a document, and the deletion itself. Shown while
 * `document` is set; `onClose` follows both Cancel and a finished delete.
 */
export function DeleteDocumentDialog({
  document: d,
  onClose,
  onDeleted,
  fallbackFocus,
}: {
  document: { id: string; title: string } | null;
  onClose: () => void;
  onDeleted?: () => void;
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  const client = useClient(DocumentService);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => client.deleteDocument({ id }),
    onSuccess: async (_, id) => {
      toast.success("Document deleted");
      queryClient.removeQueries({ queryKey: ["documents", id] });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });
  return (
    <ConfirmDialog
      open={d !== null}
      title="Delete document?"
      confirmLabel="Delete"
      pending={remove.isPending}
      error={remove.error?.message}
      onConfirm={() =>
        d &&
        remove.mutate(d.id, {
          onSuccess: onDeleted,
          onSettled: onClose,
        })
      }
      onCancel={onClose}
      fallbackFocus={fallbackFocus}
    >
      “{d?.title}” and its passages will be deleted. Chat can no longer use them. This can't be
      undone.
    </ConfirmDialog>
  );
}
