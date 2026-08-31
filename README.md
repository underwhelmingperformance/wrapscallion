# wrapscallion

_For the pedants, for the perfectionists, for the alignment lovers._

![Claude Code tries to commit a commit message which isn't properly wrapped. It's refused by the pre-commit hook. Claude says "Nice bit of dogfooding — wrapscallion's own `commit-msg` hook rejected my message because the body wasn't wrapped to 72 columns, and it handed back the correctly reflowed version. Let me commit with that wrapping." It then retries and the commit goes through.](./wrapscallion.webp)

`wrapscallion` is a Git commit message linter. It'll ensure your - or, more
importantly, your agents' - commit messages follow Conventional Commits, and
that their Markdown body lines fit within 72 display columns. Agents cannot be
trusted to do this right consistently, so `wrapscallion` can
[run as a pre-commit hook](#pre-commit) and as a check in
[GitHub Actions](#github-actions), to keep things tidy all of the time.

## Use

You'll want to run `wrapscallion` automatically, ideally as a Git hook, so that
incorrectly-wrapped commits can't even be created.

### Pre-Commit

We suggest using [`pre-commit`][pre-commit], so that your commits fail before
they are made.

`wrapscallion`'s default hook is Docker-backed, so Docker needs to be installed
on the system. Each release pins this hook to the published image by digest, so
the `rev` you pin selects the exact, attested image that runs.

<!-- x-release-please-start-version -->

```yaml
default_install_hook_types:
  - pre-commit
  - commit-msg
default_stages:
  - pre-commit
repos:
  - repo: https://github.com/underwhelmingperformance/wrapscallion
    rev: v0.2.2
    hooks:
      - id: wrapscallion
```

<!-- x-release-please-end -->

On machines that already have Deno installed, you can use `wrapscallion-system`
instead.

<!-- x-release-please-start-version -->

```yaml
default_install_hook_types:
  - pre-commit
  - commit-msg
default_stages:
  - pre-commit
repos:
  - repo: https://github.com/underwhelmingperformance/wrapscallion
    rev: v0.2.2
    hooks:
      - id: wrapscallion-system
```

<!-- x-release-please-end -->

[pre-commit]: https://pre-commit.com/

### GitHub Actions

Use our action to lint each commit in a pull request. The checkout must fetch
the full history so that the selected commit range exists locally.

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
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v0.2.2
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: underwhelmingperformance/wrapscallion@v0.2.2
        with:
          ignore: |
            ^chore\(.*\): release
```

<!-- x-release-please-end -->

The action reads `.wrapscallion.toml` from the repository root. It also takes an
`ignore` input, with one `ignore` pattern per line.

For `pull_request` and `merge_group` events, the action can work out which
commits it needs to check. For other events, you can pass `from` and `to`
inputs:

```yaml
name: commit-messages

on:
  push:

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: underwhelmingperformance/wrapscallion@v0.2.1
        with:
          from: ${{ github.event.before }}
          to: ${{ github.sha }}
```

## CLI

Prebuilt binaries are available for Linux, macOS and Windows on the
[releases page][releases].

<!-- x-release-please-start-version -->

```sh
repo=underwhelmingperformance/wrapscallion
tag=v0.2.2
asset=wrapscallion-0.2.2-unknown-linux-gnu

gh release download "${tag}" \
  --repo "${repo}" \
  --pattern "${asset}"
```

<!-- x-release-please-end -->

## Verify before running

> [!WARNING]
> These checks do not prove that the binaries or images are safe to run. They
> show that a binary belongs to a named GitHub release, or that a binary or
> image has provenance signed by the expected workflow.

`wrapscallion`'s container images and binaries come with
[SLSA provenance attestations][attestation], which you can use to verify that
the release artifacts were built from the expected workflow in this repository.

### Container images

Each release pins the Docker-backed hook to an image digest in
`.pre-commit-hooks.yaml`. The GitHub CLI needs credentials for GHCR before it
can verify an OCI image. Once you have signed in, read the pinned image from the
tag and verify that our build workflow attested it:

<!-- x-release-please-start-version -->

```sh
repo=underwhelmingperformance/wrapscallion
tag=v0.2.2
image="$(
  gh api \
    --header 'Accept: application/vnd.github.raw+json' \
    "repos/${repo}/contents/.pre-commit-hooks.yaml?ref=${tag}" |
    awk '$1 == "entry:" { print $2; exit }'
)"

gh attestation verify "oci://${image}" \
  --repo "${repo}" \
  --signer-workflow "${repo}/.github/workflows/build.yml"
```

<!-- x-release-please-end -->

### Binaries

[Binary attestations][attestation] are published alongside releases. With the
downloaded asset in the current directory, first verify that its contents belong
to the named GitHub release:

<!-- x-release-please-start-version -->

```sh
gh release verify-asset "${tag}" "${asset}" --repo "${repo}"
```

<!-- x-release-please-end -->

To verify that it was built from our release workflow in this repository, run:

<!-- x-release-please-start-version -->

```sh
gh attestation verify "${asset}" \
  --repo "${repo}" \
  --signer-workflow "${repo}/.github/workflows/release.yml"
```

<!-- x-release-please-end -->

[attestation]: https://docs.github.com/en/actions/concepts/security/artifact-attestations
[releases]: https://github.com/underwhelmingperformance/wrapscallion/releases

## Rewording

> [!WARNING]
> Rewriting currently _does not preserve commit signatures_.

Wrapscallion can rewrite existing commit history too. Add `--reword` to a range:

```sh
wrapscallion --from origin/main --reword
```

Rewriting requires a checked-out branch with no staged or unstaged changes to
tracked files. A backup ref `refs/backup/wrapscallion/<timestamp>` will be
created so that the original commits can be recovered if necessary. Run:

```sh
wrapscallion --from origin/main --reword --dry-run
```

to see what would be rewritten, without actually doing it.

The [CLI reference][cli] covers limiting the range, recovering the original
commits, ignoring bot commits, output formats and `.wrapscallion.toml`.

[cli]: docs/cli.md

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development process stuff.

## Vibe coding level

Quite high. I wrote this document though. Look at me go.
