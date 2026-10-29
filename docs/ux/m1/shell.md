# Shell: error boundary, toasts, loading states (#58)

Shell-level building blocks that every module UI uses: a route-level error boundary per module, a toast API in `@kb/module-sdk` rendered by the shell, and skeleton/loading components in `@kb/ui`.

## Layout

```
┌──────────────┬──────────────────────────────────────────────────────┐
│ ▣ Knowledge  │ <main>                                               │
│   Base       │                                                      │
│              │   (module route content)                             │
│ ▸ Documents  │                                                      │
│   Search     │                                                      │
│ ▸ Ingestion  │                                                      │
│ ▸ Chat       │                                                      │
│ ▸ Models     │                                       ┌────────────┐ │
│              │                                       │ toast host │ │
│              │                                       └────────────┘ │
└──────────────┴──────────────────────────────────────────────────────┘
```

*Narrow (< 768 px):* the sidebar collapses into a top bar with `[☰ Menu]`, which opens the nav as a modal dialog (`Esc` closes, focus returns to the button). Toasts span the width at the bottom.

## Error boundary (per module route)

A module that throws while rendering shows an error panel in `<main>`. The sidebar and other modules keep working.

```
┌──────────────────────────────────────────────────────┐
│ Documents                                     (h1)   │
│ ┌──────────────────────────────────────────────────┐ │
│ │ ⚠ Something went wrong in Documents.             │ │
│ │   The rest of the app still works.               │ │
│ │   [Try again]   [Go to home]                     │ │
│ │   ▸ Details (collapsed: error message)           │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

- "Try again" resets the boundary and re-renders the route; navigating to another route resets it too.
- Details is a native `<details>` with the error message (no stack trace in production builds).
- The panel's heading receives focus when it appears, and the panel is `role="alert"` so it is announced once.
- Data-loading errors are **not** boundary errors: queries show `ErrorMessage` inline (see below). The boundary catches render errors only.

## Toasts

```
                                   ┌──────────────────────────────┐
                                   │ ✓ Document deleted   [Undo] ✕│
                                   └──────────────────────────────┘
                                   ┌──────────────────────────────┐
                                   │ ⚠ Couldn't rename conversa…  ✕│
                                   └──────────────────────────────┘
```

API sketch (`@kb/module-sdk`): `toast.success(message, { action? })`, `toast.error(message)`, `toast.info(message)`.

| Kind | Region | Auto-dismiss | Used for |
|---|---|---|---|
| success / info | `role="status"` (polite) | 5 s, paused on hover/focus | Delete, rename, upload finished |
| error | `role="alert"` | No; must be dismissed | Failed background actions |

- Toasts never take focus. The host is a landmark (`<section aria-label="Notifications">`), so it can be reached with screen-reader landmark navigation, and toast actions are reachable by `Tab` after the main content.
- `✕` is a button labelled "Dismiss notification"; `Undo` is a button whose label names the action ("Undo delete").
- At most three are visible; older ones collapse.
- The live regions exist from page load (empty), so the first toast is announced.

## Loading states

| Component (`@kb/ui`) | Use | Accessible behaviour |
|---|---|---|
| `Skeleton` (lines, table rows, card) | First load of lists and detail pages | `aria-hidden`; the container has `aria-busy="true"` and a visually hidden "Loading documents" text |
| `Spinner` | Actions in progress (inside buttons, small areas) | `role="status"` with a label |
| `DelayedLoading` wrapper | Avoids flicker | Shows its fallback only after 300 ms |

```
Documents                                         [Upload documents]
┌──────────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░   ░░░░░░   ░░░░░░░░   ░░░░                  │
│ ░░░░░░░░░░░░░░         ░░░░░░   ░░░░░░░░   ░░░░                  │
│ ░░░░░░░░░░░░░░░░░░     ░░░░░░   ░░░░░░░░   ░░░░                  │
└──────────────────────────────────────────────────────────────────┘
```

Inline error state, the same in every module:

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ Couldn't load documents. The document service isn't available  │
│   right now.                                         [Try again] │
└──────────────────────────────────────────────────────────────────┘
```

## Keyboard and focus

1. `Tab` order: skip link "Skip to content" (first focusable) → sidebar nav → `<main>` → toast host.
2. After a route change, focus moves to the new page's `<h1>` (`tabindex="-1"`); the skip link jumps there too.
3. Active nav item has `aria-current="page"`.

## Open questions

- Should module nav items show counts (e.g. failed jobs)? Proposed: not in M1.
