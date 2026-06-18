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

### Ignoring commits

Some commits are not worth linting, such as those created by release tooling,
which rarely follow Conventional Commits. Pass `--ignore` with a regular
expression to skip any commit whose subject matches it, and repeat the flag to
give more than one pattern:

```sh
deno task wrapscallion --from origin/main --ignore '^chore\(.*\): release '
```

Skipped commits are neither linted nor reworded, but they stay in place so that
rewording the rest of the range keeps the history linear. The report says how
many commits were skipped. Patterns are usually easier to keep in the
[configuration file](#configuration).

Patterns use [RE2][re2] syntax, which matches in time linear in the subject
length and so cannot be made to backtrack catastrophically. It does not support
backreferences or lookaround; a pattern that uses them is reported as invalid.

[re2]: https://github.com/google/re2/wiki/Syntax

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

## Configuration

Wrapscallion reads its settings from a `.wrapscallion.toml` file in the
repository root, if one is present. Every command-line flag can be set there
instead, using the flag's long name as the key. A flag passed on the command
line always takes precedence over the file.

```toml
output-format = "github"
ignore = ['^chore\(.*\): release ']
```

The `ignore` key takes a list of regular expressions, the same patterns the
`--ignore` flag accepts. A command-line `--ignore` replaces the patterns from
the file rather than adding to them.

## Pre-Commit

Projects using [pre-commit][pre-commit] can install wrapscallion as a
`commit-msg` hook. The default hook is Docker-backed, so consumers need Docker
but do not need Deno or Git installed in the hook image. Each release pins this
hook to the published image by digest, so the `rev` you pin selects the exact,
attested image that runs.

<!-- x-release-please-start-version -->

```yaml
repos:
  - repo: https://github.com/underwhelmingperformance/wrapscallion
    rev: v0.1.0
    hooks:
      - id: wrapscallion
```

<!-- x-release-please-end -->

For a faster local hook on machines that already have Deno installed, use
`wrapscallion-system` instead.

[pre-commit]: https://pre-commit.com/

## GitHub Actions

Use the bundled action to lint each commit in a pull request. The workflow must
fetch the full history so the selected commit range exists locally.

<!-- x-release-please-start-version -->

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
      - uses: actions/checkout@<latest SHA> # vX.Y.Z
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: underwhelmingperformance/wrapscallion@v0.1.0
```

<!-- x-release-please-end -->

The action reads `.wrapscallion.toml` from the repository root just as the
command does. It also takes an `ignore` input, with one pattern per line, for
projects that would rather configure the skipped commits in the workflow than in
a file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, the branch protection
rules, and how releases are cut.
