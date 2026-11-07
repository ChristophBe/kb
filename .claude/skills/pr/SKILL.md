---
name: pr
description: Commit, push and open a pull request in this repo following CONTRIBUTING.md (Conventional Commits PR title, PR template, required checks). Use when asked to commit, open, create or title a PR, or to write a commit message.
---

# Commits and pull requests

CONTRIBUTING.md ("Pull requests", "PR titles and commit messages") is the source of truth; read it first.

## 1. Before pushing

Run `task gen` (commit any output), `task lint` and `task test`. Never force-push.

## 2. Commit messages

PRs are squash-merged, so the PR title becomes the commit on `main`. Branch commits still use the same format: `<type>[(<scope>)][!]: <summary>`, imperative, lower-case start, no trailing full stop, body explaining why. End with the attribution trailer Claude Code is configured to add (`Co-Authored-By: …`).

## 3. PR title

Derive it from the issue the PR closes (`gh issue view <n> --json title,labels`):

| Issue label | Type |
|---|---|
| `type:feature` | `feat` |
| `type:bug` | `fix` |
| `type:docs` | `docs` |
| `type:chore` | `chore`, or `ci` / `build` / `refactor` / `test` / `perf` when that fits better |

- Scope: the issue's `module:*` / `area:*` label without the prefix (`fix(document): …`, `ci(infra): …`), `deps` for dependency bumps, or none when the change spans several.
- `!` after type/scope for a breaking change (major bump); say what breaks in the body.
- Allowed types and scopes are enforced by `.github/workflows/pr-title.yml`.

## 4. PR body

Fill in `.github/pull_request_template.md`: `Closes #<n>`, *What changed*, and the checklist (tick or mark not applicable; delete the UI section without UI changes). Copy the issue's acceptance criteria as `- [ ]` checkboxes. Write the body to a scratchpad file and end it with the attribution line Claude Code is configured to add.

```sh
gh pr create --base main --title "fix(document): reject empty uploads" --body-file <file>
gh pr checks --watch
```
