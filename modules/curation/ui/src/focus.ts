import { type RefObject, useEffect, useRef } from "react";

/**
 * Puts the focus back on `target` once a dialog that was open has closed. It
 * waits for the dialog to be gone: while a modal dialog is open the rest of the
 * page is inert and can't take the focus.
 */
export function useReturnFocus(open: boolean, target: RefObject<HTMLElement | null>) {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      target.current?.focus();
    }
  }, [open, target]);
}
