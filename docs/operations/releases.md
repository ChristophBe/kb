# Releases

Every push to `main` is released. The [`release` workflow](../../.github/workflows/release.yml) runs [go-semantic-release](https://github.com/go-semantic-release/semantic-release) on the pushed commit; it works out the next version from the commit titles since the last tag, creates tag `vX.Y.Z` and a GitHub release whose notes list the commits grouped by type.

## Versions

PRs land as merge commits, so each push to `main` brings the PR's branch commits plus a merge commit whose title is the PR title, all in [Conventional Commits](../../CONTRIBUTING.md#pr-titles-and-commit-messages) form. The highest bump among them wins, so a `feat` branch commit makes a `fix` PR a minor release, and the release notes list the branch commits as well as the PR:

| Commit | Bump | Example |
|---|---|---|
| `!` or a `BREAKING CHANGE:` footer | major (minor while on `0.x`, see below) | `feat(chat)!: drop the v1 conversation API` |
| `feat` | minor | `v0.2.0` → `v0.3.0` |
| any other type (`fix`, `chore`, `ci`, `docs`, …) | patch | `v0.2.0` → `v0.2.1` |
| no Conventional Commits type | patch | `Update README` |

The first release is `v0.1.0`. While the major version is `0`, go-semantic-release treats a breaking change as a minor bump (semver's initial development phase); it has no option to bump `0.x` to `1.0.0` on its own. To release `1.0.0`, create the tag by hand on a `main` commit (`gh release create v1.0.0 --target <sha> --generate-notes`); from then on breaking changes bump the major version.

Runs for the same ref are serialised (`concurrency`), so two quick merges give two versions. GitHub keeps only one waiting run per group: when a third push arrives while one run is going and one is waiting, the waiting run is cancelled and the newest one releases both commits under one version. A re-run of an older push that is already released, or that a newer release has overtaken, does nothing.

The released version (without the `v`, e.g. `0.3.1`) is the `version` output of the `release` job. Image builds pass it as build arg `KB_VERSION` (`deploy/docker/*.Dockerfile`); every service logs it at startup (Go: `"msg":"starting",…,"version":"0.3.1"`, Python: `starting version 0.3.1`, web: `kb web starting version 0.3.1`) and the images carry it as label `org.opencontainers.image.version`. Builds without it report `dev`.

## GitHub App

The release is created with a GitHub App token rather than `GITHUB_TOKEN`, because tags and releases created with `GITHUB_TOKEN` don't trigger other workflows (image and chart builds run on the tag). Until the app is configured, every push to `main` fails the `release` workflow with *Release app missing*.

One-time setup (repository admin):

1. Create a GitHub App under *Settings → Developer settings → GitHub Apps → New GitHub App* (personal account or organisation that owns the repository):
   - name e.g. `kb-release`, homepage URL the repository URL,
   - *Webhook*: untick *Active*,
   - *Repository permissions*: **Contents: Read and write** (Metadata: Read-only is added automatically), nothing else,
   - *Where can this GitHub App be installed?*: *Only on this account*.
2. On the app's page note the **Client ID**, then under *Private keys* click *Generate a private key* and keep the downloaded `.pem` file.
3. *Install App* → install it on the account, *Only select repositories* → this repository.
4. In the repository, add the credentials (*Settings → Secrets and variables → Actions*), or with the GitHub CLI:

   ```sh
   gh variable set RELEASE_APP_CLIENT_ID --body '<client id>'
   gh secret set RELEASE_APP_PRIVATE_KEY < kb-release.<date>.private-key.pem
   ```

5. If a ruleset or branch protection restricts tag creation, add the app to its bypass list. Then re-run the last failed `release` run (*Actions → release → Re-run jobs*) to create `v0.1.0`.
