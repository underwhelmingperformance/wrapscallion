# Contributing

## Development

Run the full local gate before pushing:

```sh
deno task check
```

This runs formatting, linting, type-checking and the test suite; `deno task fix`
applies formatting. Install the project's own hooks with `pre-commit install`
(it lints commit messages with wrapscallion itself).

`main` is protected: changes land through a pull request and the rebase merge
queue, the `check`, `actionlint`, `zizmor`, `lint` and `guard` checks must pass,
and history stays linear. The queue re-creates the commits it merges, so
signatures made on a pull request do not survive onto `main`.

## Running from a source checkout

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

## Releasing

Releases use [GitHub immutable releases][immutable], which are enabled once
under the repository's Settings (Code security → Immutable releases). Once
enabled, each published release gets a signed attestation over its tag and
commit, and the tag is protected from being moved or deleted.

Releasing is automated with [release-please][release-please] and runs in two
stages.

The `release-please` workflow watches `main` and keeps a release pull request up
to date from the Conventional Commits since the last release. That pull request
bumps the version in `deno.json`, refreshes the pinned `rev` and `uses` examples
in the README, and updates the changelog. It uses an installation token for the
`shipperofbytes` GitHub App, so its commits and pull-request updates trigger the
ordinary Actions workflows. The changelog commit body does not wrap to 72
columns, which is why `.wrapscallion.toml` ignores subjects matching
`^chore\(.*\): release`.

The workflows read the App credentials from the `SHIPPEROFBYTES_CLIENT_ID` and
`SHIPPEROFBYTES_PRIVATE_KEY` repository secrets. The App installation needs
write access to contents, issues and pull requests; each job requests only the
permissions it uses for its installation token. A separate ruleset restricts the
`release-please--branches--*` branches so that only the App can create, update
or delete them.

Each update to the release pull request also runs the `release` workflow. The
workflow builds the multi-architecture image reproducibly, using the release
commit's timestamp as the `SOURCE_DATE_EPOCH`, pushes a candidate index to the
GitHub Container Registry, and attests the index. It then commits that digest to
the Docker-backed pre-commit hook. The pin commit's own synchronize run
recognises that only the hook manifest changed and skips the build, so pinning
ends after one commit.

Once all required checks pass, merge the release pull request through the merge
queue, on its own. The required `guard` check refuses a merge group whose tree
differs from the release pull request's tree, the tree the pinned digest was
built from. release-please refreshes the release branch whenever `main` moves,
so a refused merge only needs re-queuing once the branch has been rebuilt and
re-pinned. Merging the pull request is the only manual release gate.

The merged event compiles and attests the standalone binaries, creates a draft
GitHub release on the merge commit and uploads them to it, verifies the pinned
index against its build attestation, and promotes it to the `vX.Y.Z`, `vX.Y`,
`vX` and `latest` tags. Once every step succeeds, the GitHub App publishes the
draft. GitHub creates the version tag at that point and makes the release
immutable.

The queue's rebase gives the merged commit a new committer time, so the epoch
the image was built with cannot be re-derived from the tag. To reproduce a
released image, read the epoch back from the published image configuration's
`created` field and pass it as the `SOURCE_DATE_EPOCH` build argument.

[immutable]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-immutable-releases
[release-please]: https://github.com/googleapis/release-please
