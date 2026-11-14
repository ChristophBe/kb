---
name: implement
description: Implement a GitHub issue end to end in this repo: read the issue, create a branch and worktree, plan, implement, review the code, then file a PR. Use when asked to implement, build, work on, pick up or fix issue #n.
---

# Implementing an issue

CONTRIBUTING.md and CLAUDE.md are the source of truth; read them first. The argument is an issue number (or URL). If none is given, ask for it.

## 1. Read the issue

```sh
gh issue view <n> --json number,title,body,labels,milestone,state
gh issue view <n> --comments
```

- Check the Definition of Ready (CONTRIBUTING.md). If the issue is not ready (vague acceptance criteria, open questions, unmet *Depends on #n*), stop and say what is missing; suggest `/issue` to refine it. Do not guess.
- Read the parent epic and linked issues when the body refers to them. Check `gh pr list --search "<n>"` so you do not duplicate work already in flight.
- Note the acceptance criteria; they drive the plan and the PR body.

## 2. Branch and worktree

Branches are `<type>/<n>-<short-slug>` where type follows the `type:*` label (`feat`, `fix`, `docs`, `chore`), e.g. `feat/27-reindex`. Worktrees live in `.worktrees/<branch>` inside the main checkout.

```sh
git fetch origin main
git worktree add -b <branch> .worktrees/<branch> origin/main
cd .worktrees/<branch>
```

Run it from the main checkout root (`git rev-parse --git-common-dir` points at it). If the branch or worktree already exists, reuse it after looking at its state; never delete someone else's work. Do all further work inside the worktree. Run `task setup` there if the hooks or dependencies are missing.

## 3. Plan

Explore the code the issue touches (CodeGraph first when `.codegraph/` exists). Write a short plan: files per layer (proto, backend, migrations, UI, docs), generated outputs, tests to add, and the user-manual page or ADR the PR needs (CONTRIBUTING.md). Check the module rules in CLAUDE.md (dependencies only via `depends_on`, generated files never hand-edited, LLM vendors only in `llm`).

For small issues keep the plan in your head and state it in one paragraph. For large or risky changes, present the plan and wait for approval. If the work is clearly more than one PR, say so and stop instead of sprawling.

## 4. Implement

- Follow `docs/coding-standards.md` and, for UI work, `docs/ux-standards.md`.
- Match the surrounding code's idiom, naming and comment density.
- Write tests with the change (coverage is enforced per component).
- After touching a proto, a `module.yaml` or SQL queries run `task gen` and keep the output.
- Update `docs/user-manual/` for user-facing changes, and add an ADR where CONTRIBUTING.md requires one.
- Commit in coherent steps using Conventional Commits (see the `/pr` skill), each ending with the attribution trailer Claude Code is configured to add. Stay in scope; note unrelated findings in the PR instead of fixing them.

## 5. Verify and review

1. Run `task gen`, `task lint` and `task test` (plus `task test:integration` for store changes). Fix failures; never skip or weaken checks. For UI or runtime behaviour, exercise it for real (see the project's verification notes: isolated compose project, real browser).
2. Review your own diff against `origin/main` with the `code-review` skill (and `simplify` for cleanups). Fix every valid finding, then re-run the checks.
3. Walk the issue's acceptance criteria one by one and confirm each is met.

## 6. File the PR

Follow the `/pr` skill: rebase on `origin/main` (no merge commits, no force pushes of shared history), push with `-u`, and open the PR with a Conventional Commits title derived from the issue labels and a body based on `.github/pull_request_template.md` containing `Closes #<n>`, the acceptance criteria as checkboxes, and anything you deliberately left out.

```sh
git fetch origin main && git rebase origin/main
git push -u origin <branch>
gh pr create --base main --title "<title>" --body-file <file>
gh pr checks --watch
```

Report the PR URL, check results and any open follow-ups. Leave the worktree in place until the PR is merged.
