# User manual

This folder is the end-user manual for kb. The web UI shows it on its help page, and the chat uses it to answer how-to questions, so every page has to read well on its own and link by section.

The design drafts in [`docs/ux/`](../ux/) are for contributors; this manual is for the people using the tool.

## Rules

- **Audience: the end user.** Describe what they see and do in the UI. No internals: no code, APIs, services, module names, databases or configuration.
- **Current behaviour only.** Describe the tool as it is on `main`. No changelog, no "new in", no "previously", no planned features. When behaviour changes, rewrite the description; when a feature is removed, remove its description.
- **One page per area** of the UI (for example documents, search, chat). A task belongs to the area where the user starts it.
- **Kept up to date with the code.** A pull request that adds or changes a user-facing feature updates the matching page; see [CONTRIBUTING.md](../../CONTRIBUTING.md#pull-requests).

## Pages

- File name: the area in lower-case kebab case, `<area>.md` (`getting-started.md`, `documents.md`). The file name is the page's address on the help page (`/help/<area>`), so don't rename a page without updating links to it.
- One `#` heading: the area's name as the UI shows it (`# Documents`), followed by one or two sentences on what the area is for.
- One `##` heading per task, phrased as what the user wants to do ("Upload a document", "Stop an answer"). Each `##` section is a link target (`/help/<area>#<section>`) and a unit the chat cites, so it must make sense without the rest of the page. Keep headings unique within a page and change them only with their links.
- Use `###` only to split a long task; don't go deeper.
- Inside a section: a short explanation, then numbered steps for procedures. Name buttons and labels exactly as the UI shows them, in **bold**. Mention what the user sees when something goes wrong and what to do about it.
- Plain Markdown only: no HTML, no screenshots (they go stale), relative links between pages (`[search](search.md#search-documents)`).
- Every page is listed in the index below.

## Index

<!-- One line per page: [Title](file.md) — what it covers. -->
