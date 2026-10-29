# UX and accessibility standards

Rules for every UI in kb: the shell (`apps/web`), the shared kit (`platform/ui/kit`, package `@kb/ui`) and module UIs (`modules/*/ui`). New UI work follows them and reviews check against them, using the UI checklist in the PR template. Code conventions for the TypeScript side are in the [coding standards](coding-standards.md); the automated gates are listed under [Automated checks](#automated-checks).

## Accessibility target

kb meets **[WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA**. These success criteria matter most for this app:

| SC | Requirement | How we meet it |
|---|---|---|
| [1.3.1](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships) Info and relationships | Structure is in the markup, not just the styling. | Real headings (`<h1>` per page from `PageHeader`, then `<h2>`), lists, `<table>` with `<th scope>`, `<label>` for every control, `<fieldset>`/`<legend>` for groups. |
| [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) Contrast (text) | 4.5:1 for text, 3:1 for large text. | Use the colour tokens; every text/background pair is AA in light and dark. |
| [1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow) Reflow | Usable at 320 CSS px without horizontal scrolling. | Layouts collapse (see [breakpoints](#responsive-breakpoints)); wide tables scroll inside their own container. |
| [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast) Non-text contrast | 3:1 for control boundaries, focus indicators, icons that carry meaning. | `border-border-strong` for inputs and secondary buttons, `--color-focus` ring. `border-border` is for decoration only. |
| [2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) Keyboard | Everything works with the keyboard alone. | Native `<button>`, `<a href>`, `<input>`; no click handlers on `<div>`. Hover-only affordances (e.g. a delete icon) also appear on `:focus-visible`/`:focus-within`. |
| [2.1.2](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap) No keyboard trap | Focus can always leave a component. | Dialogs trap focus only while open and close on `Esc`. |
| [2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible) / [2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) Focus visible, not obscured | A visible focus indicator that sticky UI doesn't cover. | Global `:focus-visible` outline from `theme.css`; never `outline-none` without a replacement. Sticky composers/headers leave room (`scroll-padding`). |
| [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) Target size | Pointer targets at least 24×24 px (or spaced so a 24 px circle doesn't overlap another). | Icon buttons are at least `size-6` including padding. |
| [4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value) Name, role, value | Every control has an accessible name and state. | Visible label, or `aria-label` on icon-only buttons; `aria-current="page"` on the active nav link (React Router's `NavLink` sets it); `aria-expanded`/`aria-pressed` where applicable. |
| [4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) Status messages | Status changes are announced without moving focus. | `ErrorMessage` is `role="alert"`, `Spinner` is `role="status"`; toasts and job progress use live regions (see below). |
| [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions) Reduced motion (AAA, adopted) | Respect `prefers-reduced-motion`. | `theme.css` shortens animations and transitions; JS that animates (e.g. `scrollIntoView({ behavior: "smooth" })`) checks `matchMedia("(prefers-reduced-motion: reduce)")`. |

## Interaction patterns

Follow the [WAI-ARIA Authoring Practices (APG)](https://www.w3.org/WAI/ARIA/apg/patterns/). **Native elements first**: a `<button>`, `<a>`, `<select>`, `<dialog>` or `<details>` beats ARIA on a `<div>`. Add ARIA only when no native element fits, and then implement the full APG keyboard model. Shared patterns live in `@kb/ui`, so modules don't each re-implement them.

| Pattern | Use for | Rules |
|---|---|---|
| [Dialog (modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Confirmations, metadata editing | Native `<dialog>` with `showModal()`. Focus moves to the first field (or the least destructive button); `Tab` cycles inside; `Esc` closes; focus returns to the trigger. Title via `aria-labelledby`. |
| [Menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) | Per-item actions (rename, delete) | Trigger has `aria-haspopup="menu"` and `aria-expanded`; arrows move, `Enter`/`Space` activate, `Esc` closes and refocuses the trigger. Simple lists of links are not menus; use a list. |
| [Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | Switching views in one page (e.g. document details / chunks) | `role="tablist"`/`tab`/`tabpanel`, arrows between tabs, one tab in the tab order (roving `tabindex`). If each view has its own URL, use links instead. |
| [Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) | Command palette (⌘K), document pickers | Input with `role="combobox"`, `aria-expanded`, `aria-controls` → `listbox`, `aria-activedescendant` for the highlighted option; arrows move, `Enter` selects, `Esc` closes. Announce result counts in a polite live region. |
| Toasts / live regions ([alert](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)) | Confirmation of background actions ("Document deleted") | One shell-level region: `role="status"` (polite) for success/info, `role="alert"` only for errors. Toasts don't take focus, stay at least 5 s, pause on hover/focus and can be dismissed. Never put the only copy of important information or the only route to an action in a toast. |
| Streaming chat output | Chat answers arriving token by token | Don't make the growing message a live region (it would announce every token). The message list is a `role="log"` with `aria-live="off"` while streaming; when the answer completes, announce "Answer ready" (or the error) once through the polite status region. `aria-busy="true"` on the message while it streams. The stop button stays focusable during streaming, and focus stays in the composer. |

## Design tokens

Tokens are Tailwind theme variables defined in [`platform/ui/kit/src/theme.css`](../platform/ui/kit/src/theme.css), imported once by the shell (`apps/web/src/index.css`). **Module UIs use token utilities only**: no raw palette classes (`zinc-500`, `red-50`, `bg-white`, …), no `dark:` variants, and no arbitrary colour values. Dark mode follows the OS setting (`prefers-color-scheme`) and needs no extra classes, because the tokens switch.

| Role | Utilities | Use |
|---|---|---|
| Canvas | `bg-canvas` | Page background (set on `<body>`). |
| Surface | `bg-surface`, `bg-surface-muted` | Cards, sidebars, inputs; hover/selected rows and subtle fills. |
| Text | `text-fg`, `text-fg-muted` | Body text and headings; secondary text, meta, icons. |
| Border | `border-border`, `divide-border`, `border-border-strong` | Decorative dividers; boundaries that identify a control (inputs, secondary buttons) and must reach 3:1. |
| Accent | `bg-accent`, `hover:bg-accent-hover`, `text-on-accent` | Primary actions, the user's own chat messages. |
| Focus | `--color-focus` (global `:focus-visible` outline) | Never override per component. |
| Status | `text-{tone}` on `bg-{tone}-subtle` for `neutral`, `info`, `success`, `warning`, `danger` | Badges, alerts, inline errors. Status is never shown by colour alone; add text or an icon with a label. |

| Scale | Tokens |
|---|---|
| Spacing | Tailwind's 4 px step (`--spacing: 0.25rem`). Prefer 1, 2, 3, 4, 6, 8, 12. |
| Type | `text-xs` (12 px, badges/meta), `text-sm` (14 px, body and controls), `text-base` (16 px, chat messages, long text), `text-lg` (18 px, section headings), `text-xl` (20 px, page titles). No other sizes exist. |
| Radius | `rounded-control` (buttons, inputs, nav items, alerts), `rounded-card` (cards, dialogs), `rounded-full` (badges, avatars, spinners). |
| Focus ring | 2 px solid `--color-focus`, 2 px offset. |

A new token needs an entry in both tables and a pair for every combination it's used in, added to `platform/ui/kit/src/theme.test.ts` (light and dark are checked automatically).

## UX conventions

### Loading, empty, error, success

Every view that loads data shows exactly one of these states:

- **Loading:** a `Spinner` with a label ("Loading documents") in place of the content, or a skeleton of the same layout. Wait about 300 ms before showing it so fast responses don't flicker. Never blank.
- **Empty:** `EmptyState` with one sentence saying what will appear here and the action that creates it ("No documents yet. Upload one to get started." + link).
- **Error:** `ErrorMessage` with what failed in plain words, and a retry action when retrying can help. gRPC `UNAVAILABLE` → "<Module> is not available right now. Try again in a moment." Don't show raw stack traces or status codes as the main message.
- **Success:** the content. For actions without a visible result (delete, background save), confirm with a polite toast.

### Forms and validation

- Every field has a visible `<label>`; hints and errors are linked with `aria-describedby`.
- Validate on submit and on blur, not on every keystroke. On submit with errors, move focus to the first invalid field, set `aria-invalid="true"`, and show the message next to the field in `text-danger`.
- Error messages say how to fix it: "Title must not be empty", not "Invalid input".
- Disable the submit button only while the request is in flight (and show progress); otherwise keep it enabled and explain errors.
- `Enter` submits single-line forms; in the chat composer `Enter` sends and `Shift+Enter` adds a line break.

### Destructive actions

- Deleting a document or conversation asks for confirmation in a dialog that names the item ("Delete 'report.pdf'? Its chunks and citations will be removed."). The confirm button says what it does ("Delete document") and uses the `danger` variant; focus starts on "Cancel".
- Where undo is cheap, prefer an "Undo" toast over a confirmation dialog.
- After deletion, move focus to a sensible place (the next item, or the list heading), never to `<body>`.

### Terminology and microcopy

- Use the same words everywhere: **document** (not file once uploaded), **upload**, **chunk**, **conversation** (a chat thread), **message**, **answer**, **citation**, **model**.
- Sentence case for everything ("Upload documents", not "Upload Documents"). Buttons start with a verb. No "Please", no exclamation marks, no blame ("Couldn't load documents", not "You caused an error").
- Times are relative when recent ("2 min ago") with the absolute time in a `title`/`<time dateTime>`; sizes via `formatBytes`.

### Responsive breakpoints

Tailwind's default breakpoints apply. Design mobile first:

| Width | Layout |
|---|---|
| < 640 px (default) | Single column; the shell's navigation collapses into a menu button; secondary panes (e.g. the chat conversation list) become their own view. |
| `sm` ≥ 640 px | Forms and dialogs get their max width; tables may show more columns. |
| `md` ≥ 768 px | Shell sidebar visible; two-pane layouts (list + detail, conversations + chat). |
| `lg` ≥ 1024 px | Wider content area; optional third column (e.g. citations panel). |

Content stays usable at 320 px and at 200 % zoom; text never truncates without a way to see the full value (tooltip, wrap or detail view).

## Automated checks

These run in `task lint` / `task test` and fail CI:

| Check | Where | Catches |
|---|---|---|
| Biome `a11y` rules, all as errors | `biome.json`, `task lint` | Missing labels and alt text, interactive handlers on non-interactive elements, invalid ARIA, … A justified exception needs `biome-ignore lint/a11y/<rule>: <reason>`. |
| axe-core on every kit component | `platform/ui/kit/src/components.test.tsx`, `task test` | Rendered accessibility violations (names, roles, ARIA, structure). |
| Token contrast | `platform/ui/kit/src/theme.test.ts`, `task test` | Every text/background (4.5:1) and control/focus (3:1) pair in light and dark mode, resolved against Tailwind's palette. |

Module UI tests use the same helper: `import { expectNoAxeViolations } from "@kb/ui/testing"` after rendering. It turns off the page-level `region` rule and `color-contrast`, which jsdom can't compute; contrast is covered by the token check. Full-page scans against the running stack are part of the end-to-end tests (#14).

A new kit component gets an axe test. A new colour token gets pairs in `theme.test.ts`.

## Review checklist

UI PRs tick the "UI changes" section of the PR template:

- **Keyboard only:** every new or changed flow works with `Tab`, `Shift+Tab`, `Enter`, `Space`, `Esc` and arrows where a pattern requires them; focus is always visible and lands in a sensible place after each action.
- **Screen reader smoke test** with VoiceOver (macOS) or NVDA (Windows): controls have names, status changes are announced once, headings make sense in the rotor.
- **200 % zoom and 320 px width:** nothing overlaps or needs horizontal scrolling.
- **Dark mode:** switch the OS appearance; no unreadable text or invisible borders, no raw palette classes.
