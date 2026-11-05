import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * Modal dialog on the native `<dialog>`: the browser traps focus, makes the page
 * inert and closes on Escape, which calls `onClose`. The opener restores focus.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] glass-strong rounded-panel p-0 text-fg backdrop:bg-black/30 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="text-sm">{children}</div>
          <div className="flex flex-wrap justify-end gap-2">{footer}</div>
        </div>
      )}
    </dialog>
  );
}
