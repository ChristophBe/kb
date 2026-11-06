import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { Button } from "./components.tsx";
import { Dialog } from "./dialog.tsx";

/**
 * Asks before a destructive action. Cancel comes first, so it has the focus when
 * the dialog opens; Escape cancels. On closing, the focus returns to the element
 * that opened it, or to `fallbackFocus` when that is gone (e.g. the list after
 * its row was deleted). While `pending`, both buttons are disabled.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
  fallbackFocus,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  // Set while open: the element that had the focus before (null if none).
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  // A layout effect, so the opener is taken before Dialog's effect opens the
  // modal and moves the focus into it.
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
  }, [open]);
  // A passive effect, so it runs after Dialog's effect has closed the modal: the
  // page is inert while it is open.
  useEffect(() => {
    if (open || opener.current === undefined) return;
    if (opener.current?.isConnected) opener.current.focus();
    else fallbackFocus?.current?.focus();
    opener.current = undefined;
  }, [open, fallbackFocus]);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
