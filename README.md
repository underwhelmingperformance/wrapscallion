# wrapscallion

Wrapscallion is a commit-message checker for projects that use Conventional
Commits and want commit bodies to be readable Markdown wrapped at 72 columns. It
can check a single `commit-msg` hook file, lint every commit in a pull request
range, and reword fixable commits on a clean local branch.

The project is distributed as a Deno command rather than a Node library. Deno is
a good fit here because the tool is an executable application: it gives us a
single runtime for checking, formatting, testing, running and compiling the
command, while still supporting the npm commitlint packages used internally. The
Deno version is pinned in `.dvmrc`.

## Use

Run the command from this checkout:

```sh
deno task wrapscallion --from origin/main --to HEAD
```

Check the file passed to a Git `commit-msg` hook:

```sh
deno task wrapscallion --edit .git/COMMIT_EDITMSG
```

Build a standalone executable:

```sh
deno task build
```

### Rewording

Wrapscallion can rewrite the commits whose only problem is a body that needs
wrapping. Add `--reword` to a range:

```sh
deno task wrapscallion --from origin/main --reword
```

Rewording rewrites history, so it has guard rails. It runs only on a clean
working tree and only on a checked-out branch (not a detached `HEAD`). Use
`--to` to limit the fixes to part of the branch: commits in `--from..--to` are
checked and reworded, while any commits between `--to` and `HEAD` are preserved,
reparented onto the corrected history (so, like any history rewrite, they get
new hashes). Before moving the branch it records the previous tip under a backup
ref named `refs/backup/wrapscallion/<timestamp>`, so the original commits remain
reachable. Use `--dry-run` to see what would change without moving anything:

```sh
deno task wrapscallion --from origin/main --reword --dry-run
```

Rewording cannot preserve commit signatures — just-git creates the new commit
objects and cannot re-sign them. Signed commits are still reworded, but the
rewritten copies are unsigned; wrapscallion prints a warning naming how many
lost their signature, and the signed originals stay reachable through the backup
ref.

### Output

By default wrapscallion writes a human-readable report with a spinner when
stderr is a terminal, and line-delimited JSON otherwise. Force one with
`--output-format terminal` or `--output-format json`. Colour is independent of
the format: it follows the usual `FORCE_COLOR`/`NO_COLOR` environment variables,
and `--colour` / `--no-colour` override them.

## Pre-Commit

Projects using [pre-commit][pre-commit] can install wrapscallion as a
`commit-msg` hook. The default hook is Docker-backed, so consumers need Docker
but do not need Deno or Git installed in the hook image. Each release pins this
hook to the published image by digest, so the `rev` you pin selects the exact,
attested image that runs.

```yaml
repos:
  - repo: https://github.com/underwhelmingperformance/wrapscallion
    rev: v0.1.0
    hooks:
      - id: wrapscallion
```

For a faster local hook on machines that already have Deno installed, use
`wrapscallion-system` instead.

[pre-commit]: https://pre-commit.com/

## GitHub Actions

Use the bundled action to lint each commit in a pull request. The workflow must
fetch the full history so the selected commit range exists locally.

```yaml
name: commit-messages

on:
  pull_request:
  merge_group:

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: underwhelmingperformance/wrapscallion@v0.1.0
```

## Development

Run the full local gate:

```sh
deno task check
```

## Releasing

Releases are cut by the `release` workflow and use
[GitHub immutable releases][immutable], which must be enabled once under the
repository's Settings (Code security → Immutable releases). Once enabled, each
published release gets a signed attestation over its tag and commit, and its tag
is protected from being moved or deleted.

To cut a release, run the `release` workflow from the Actions tab with the new
version (for example `0.2.0`). It runs `deno task check`, then:

- builds the multi-architecture Docker image and pushes it to the GitHub
  Container Registry by digest, with a build-provenance attestation;
- sets the package version and pins the pre-commit `wrapscallion` hook to the
  image digest just built;
- commits that, tags `vX.Y.Z`, and creates the immutable release.

Because the pre-commit hook's digest is written into the tagged commit, a
consumer pinning `rev: vX.Y.Z` runs exactly the image built from that tag — the
hook is pinned to the same revision it was fetched from. The image is not part
of its own build context, so writing the digest back does not change it.

The release commit is made by `github-actions[bot]` and is not GPG-signed; if
`main` requires signed commits, allow that actor or sign the commit in the
workflow.

[immutable]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-immutable-releases
