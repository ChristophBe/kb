import { toast } from "@knowcel/module-sdk";

/** Set once the user was offered browser notifications, so the offer comes only once. */
const OFFERED_KEY = "knowcel.chat.notifications-offered";

function supported(): boolean {
  return typeof Notification !== "undefined";
}

/**
 * Offers browser notifications for finished answers, once and only when the
 * browser would still ask. Permission can only be requested from a user action,
 * so the toast's button asks.
 */
export function offerNotifications() {
  if (!supported() || Notification.permission !== "default") return;
  try {
    if (localStorage.getItem(OFFERED_KEY)) return;
    localStorage.setItem(OFFERED_KEY, "1");
  } catch {
    // Without storage the offer is shown every time; that is better than never.
  }
  toast.info(
    "Want to leave while an answer is being written? Get a notification when it's ready.",
    {
      action: {
        label: "Enable notifications",
        onSelect: () => void Notification.requestPermission(),
      },
    },
  );
}

/** Shows a notification for a finished answer when the user allowed them; selecting it runs `onSelect`. */
export function notifyAnswerReady(title: string, onSelect: () => void) {
  if (!supported() || Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title || "New conversation", {
      body: "The answer is ready.",
      tag: "knowcel-chat-answer",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      onSelect();
    };
  } catch {
    // Some browsers (Android Chrome) only allow notifications through a service worker.
  }
}
