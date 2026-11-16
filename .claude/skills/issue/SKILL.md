---
name: issue
description: Write new GitHub issues or refine existing ones for this repo following CONTRIBUTING.md (epics → sub-issues, scope/type/lang labels, milestones, issue-form body shape). Use when asked to create, file, draft or write an issue, epic, feature, chore or bug, or to refine, tidy, review, split or groom an existing issue.
---

# Writing and refining issues

CONTRIBUTING.md is the source of truth for labels, epics and milestones; read it first. The issue forms in `.github/ISSUE_TEMPLATE/` define the body sections.

## 1. Gather context

```sh
gh label list --limit 100
gh api repos/{owner}/{repo}/milestones --jq '.[] | "\(.title): \(.description)"'
gh issue list --label type:epic --state open
```

Milestones are small topics (CONTRIBUTING.md, "Milestones"): put a work item into the open milestone whose goal it serves; if none fits, propose a new milestone (title and one-sentence goal) in the draft.

Look at the code the issue touches so **Changes** can name real file paths (module layout: see CLAUDE.md). Check for duplicates with `gh issue list --search "<keywords>" --state all`.

## 2. Shape

Pick one type and mirror its form's sections as `## ` headings:

| Type | Sections |
|---|---|
| `type:epic` | Goal (incl. code locations), Definition of done (checkboxes), then the line "Work items are tracked as sub-issues." |
| `type:feature` | Context, Changes (per layer: **Proto** / **Backend** / **UI**, with paths), Acceptance criteria, Notes (optional: out of scope, dependencies, open questions) |
| `type:chore`, `type:docs` | Context, Acceptance criteria |
| `type:bug` | Steps to reproduce, Expected vs. actual behaviour, Logs (optional) |

Rules (these implement the **Definition of Ready** in CONTRIBUTING.md; read its checklist):
- Title: short, imperative or noun phrase, no type prefix (epics: `Epic: <module/area>`). Issue titles stay plain; only the PR that closes the issue gets a Conventional Commits title (see "PR titles and commit messages" in CONTRIBUTING.md), derived from the issue's labels: `type:feature` → `feat`, `type:bug` → `fix`, `type:docs` → `docs`, `type:chore` → `chore` (or `ci` / `build` / `refactor` / `test` / `perf` when that fits better), scope = the `module:*` / `area:*` label without its prefix, plus `!` for a breaking change. E.g. issue "Reject empty uploads" (`type:bug module:document`) → PR `fix(document): reject empty uploads`.
- A work item is about one PR. Larger → split into several sub-issues.
- Acceptance criteria are `- [ ]` checkboxes, each observable or testable.
- Work items end with `Part of #<epic>`; every work item belongs to exactly one epic (bugs may stand alone).
- Labels: exactly one type, exactly one scope (`module:*` / `area:*`), a `lang:*` for every stack touched, `api-change` if a `.proto` changes.
- Milestone: work items get one (match the phase goals); epics get none.
- Dependencies and open questions go under Notes with issue links (`Depends on #n`); record dependencies on GitHub too (see section 4). No open question may block the work.

**UX check for work items that touch the UI** (a `lang:ts` item with a user-visible change). General UX comes before a specific flow: a flow is only done when the user can reach it and recover from its failure states. Fold these into **Changes** and **Acceptance criteria** (see `docs/ux-standards.md` and `docs/brand.md`):
- **Entry point:** say where the user reaches the feature from (nav entry, button on which page, link from which empty state). A feature on a page nobody links to is not done; actions belong on the page where the user needs them next (e.g. Download on the document page, not only in the list).
- **States:** loading, empty (say what to do next, with a link), error (inline, with a retry or next step) and, for background work, progress and completion.
- **Feedback and safety:** a result the user can see (toast or inline confirmation), a confirmation for destructive or disclosing actions, and an error shown where the user is looking, not behind a closing dialog.
- **Access:** operable by keyboard and by touch (no hover-only controls), accessible names, usable at 320 px.
- **Words:** the same term as the rest of the UI and the user manual (no "chunk" next to "passage", no internal module names such as "Ingestion" in labels).
- **No duplicate surface:** search the shell and kit for an existing component or pattern (e.g. the header search, `ConfirmDialog`, `PageHeader`) and extend it instead of adding a second one.

Example work item (title "Global command palette (⌘K) with document search", labels `type:feature area:ui-shell lang:ts`, milestone `Navigation & UI polish`):

```markdown
## Context

Navigation and search require several clicks.

## Changes

- Command palette in the shell; modules contribute commands via the SDK; document search results inline

## Acceptance criteria

- [ ] ⌘K opens the palette, typing searches documents and commands

Part of #57
```

## 3. Refining an existing issue

```sh
gh issue view <n> --json title,body,labels,milestone,parent,subIssues
```

Check it against section 2 and the Definition of Ready and report concrete findings: missing sections, vague or untestable criteria, missing file paths, wrong or missing labels, no parent epic, no milestone, too large (propose the split as separate drafts). Then present the proposed title, body and label/milestone changes.

## 4. Check the Definition of Ready

Before showing a draft or a refinement, go through every check of the **Definition of Ready** in CONTRIBUTING.md for the issue's type and list the result (✅ / ❌ with the reason). For UI work items also list the result of the UX check from section 2 (entry point, states, feedback and safety, access, words, no duplicate surface). Fix what you can in the draft; anything that can't be fixed without the user (an open question, an unclear dependency) is reported as a blocker, and the issue is not ready.

## 5. Apply (only after confirmation)

Always show the full draft (title, labels, milestone, parent, body) and wait for the user's OK before writing to GitHub. Write bodies to a file in the scratchpad and pass `--body-file`.

```sh
# create
gh issue create --title "<title>" --label type:feature --label module:chat --label lang:python \
  --milestone "<milestone>" --body-file <file>
# edit
gh issue edit <n> --title "<title>" --body-file <file> --add-label <l> --remove-label <l> --milestone "<milestone>"
# link as sub-issue of the epic (needs the issue's numeric id, not its number)
gh api repos/{owner}/{repo}/issues/<epic>/sub_issues -F sub_issue_id=$(gh api repos/{owner}/{repo}/issues/<n> --jq .id)
# record "<n> is blocked by <dep>" (again the numeric id of the blocking issue)
gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=$(gh api repos/{owner}/{repo}/issues/<dep> --jq .id)
```

Finish with the issue URL(s) and, for refinements, a one-line summary of what changed.
