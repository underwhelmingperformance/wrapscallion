# CLI reference

The standalone `wrapscallion` command and `deno task wrapscallion` in a source
checkout take the same arguments. Run `wrapscallion --help` for the complete
option list.

## Checking commits

Use `--from` to check every commit after a revision. `--to` defaults to `HEAD`:

```sh
wrapscallion --from origin/main
wrapscallion --from origin/main --to my-branch
```

Use `--edit` to check a commit message file, as the `commit-msg` hooks do:

```sh
wrapscallion --edit .git/COMMIT_EDITMSG
```

When you run the command from a source checkout, put the arguments after the
Deno task name:

```sh
deno task wrapscallion --from origin/main
```

## Rewording

> [!WARNING]
> Rewording changes commit hashes and does not preserve commit signatures.

Wrapscallion can rewrite existing commit history too. Add `--reword` to a range:

```sh
wrapscallion --from origin/main --reword
```

Rewording requires a checked-out branch with no staged or unstaged changes to
tracked files. Untracked files are fine.

Use `--to` to limit checking and rewording to part of the branch. Commits
between `--to` and `HEAD` keep their messages, but Wrapscallion recreates them
on top of the rewritten history, so their hashes also change.

Before moving the branch, Wrapscallion saves its old tip at
`refs/backup/wrapscallion/<timestamp>`. You can use this backup ref to recover
the original commits. Use `--dry-run` to see what would change without moving
the branch or creating the backup ref:

```sh
wrapscallion --from origin/main --reword --dry-run
```

If a rewritten or reparented commit was signed, its replacement is unsigned. The
report tells you how many signatures were lost. The signed originals remain
reachable through the backup ref after an applied rewrite.

## Ignoring commits

Some commits are not worth linting, such as those created by release tooling,
which rarely follow Conventional Commits. Pass `--ignore` with a regular
expression to skip any commit whose subject matches it. Repeat the flag to
supply more than one pattern:

```sh
wrapscallion \
  --from origin/main \
  --ignore '^chore\(.*\): release ' \
  --ignore '^Automatic update$'
```

Skipped commits are neither linted nor reworded, but remain in place when other
commits in the range are rewritten. The report includes the number of skipped
commits.

Patterns use [RE2 syntax][re2]. Matching takes time linear in the subject
length, so a pattern cannot trigger catastrophic backtracking. RE2 does not
support backreferences or lookaround; Wrapscallion reports patterns which use
unsupported syntax as invalid.

[re2]: https://github.com/google/re2/wiki/Syntax

## Output

Wrapscallion chooses its default output from the environment:

- A terminal gets a human-readable report and a spinner.
- A non-terminal gets line-delimited JSON.
- GitHub Actions gets the human-readable report plus an error annotation for
  each failing commit.

Use `--output-format terminal`, `--output-format json`, or
`--output-format github` to choose explicitly. The `github` format annotates
failed commits so they appear in the pull request's checks.

Colour follows the usual `FORCE_COLOR` and `NO_COLOR` environment variables.
`--colour` and `--no-colour` override them. JSON output never uses colour.

## Configuration

Wrapscallion reads `.wrapscallion.toml` from the repository root. Every
command-line flag can be set there using its long name as the key. Flags which
take no command-line value use a Boolean:

```toml
output-format = "github"
ignore = ['^chore\(.*\): release ']
```

A command-line flag takes precedence over the corresponding file setting. A
command-line `--ignore` replaces the complete `ignore` list from the file.
