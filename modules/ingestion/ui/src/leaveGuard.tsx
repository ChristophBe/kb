import { ConfirmDialog } from "@knowcel/ui";
import { useEffect } from "react";
import { useBlocker } from "react-router";

/**
 * Asks before the user leaves the page while `active` (uploads still on their way):
 * in-app navigation through a router blocker and a confirmation dialog, closing or
 * reloading the tab through the browser's own prompt. While not `active` nothing
 * intervenes. Render the returned element.
 */
export function useLeaveGuard(active: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      active && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  // Everything finished while the question was open: nothing left to lose.
  const blocked = blocker.state === "blocked";
  useEffect(() => {
    if (blocked && !active) blocker.proceed();
  }, [blocked, active, blocker]);

  return (
    <ConfirmDialog
      open={blocked && active}
      title="Leave while uploading?"
      confirmLabel="Leave page"
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    >
      <p className="text-sm">
        Some files are still uploading. If you leave now, they may not be added.
      </p>
    </ConfirmDialog>
  );
}
