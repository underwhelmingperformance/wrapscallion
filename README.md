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

Each release also attaches prebuilt standalone binaries for Linux, macOS and
Windows on the [releases page][releases], with a `SHA256SUMS` file to verify
them. These need neither Deno nor Git installed, so they suit environments where
the pre-commit hook cannot use Docker.

[releases]: https://github.com/underwhelmingperformance/wrapscallion/releases

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
stderr is a terminal, line-delimited JSON otherwise, and the `github` format
when it detects `GITHUB_ACTIONS`. Force one with `--output-format terminal`,
`--output-format json` or `--output-format github`. The `github` format writes
the same readable report as `terminal` and additionally emits a GitHub Actions
`::error` annotation for each failing commit, so failures surface on the pull
request's checks. Colour is independent of the format: it follows the usual
`FORCE_COLOR`/`NO_COLOR` environment variables, and `--colour` / `--no-colour`
override them.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, the branch protection
rules, and how releases are cut.
