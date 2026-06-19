# Contributing

## Development

Run the full local gate before pushing:

```sh
deno task check
```

This runs formatting, linting, type-checking and the test suite; `deno task fix`
applies formatting. Install the project's own hooks with `pre-commit install`
(it lints commit messages with wrapscallion itself).

`main` is protected: changes land through a pull request and the merge queue,
the `check`, `actionlint`, `zizmor` and `lint` checks must pass, history stays
linear, and commits must be signed and verified. Sign your commits and register
the signing key with your GitHub account so they verify.

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
in the README, and updates the changelog.

release-please runs as the default `GITHUB_TOKEN`, so its pull request does not
trigger the required checks on its own; it opens the pull request as a draft. To
cut a release, review it and mark it ready for review. That is a human action
and triggers the checks, which listen for `ready_for_review`. Once they pass the
pull request goes through the merge queue like any other change.

Merging the release pull request triggers the `release` workflow, which:

- builds the multi-architecture Docker image and pushes it to the GitHub
  Container Registry by digest, with a build-provenance attestation;
- pins the pre-commit `wrapscallion` hook to that digest;
- creates a release commit through the GitHub API (so GitHub signs it), parented
  on the merged commit, points the `vX.Y.Z` tag at it, and publishes the
  immutable release.

The version bump lands on `main` through the release pull request, but the
digest pin is reachable only through the tag — the digest is known only after
the build, so it cannot live in the merged commit. A consumer pinning
`rev: vX.Y.Z` runs exactly the image built from that tag; the image is not part
of its own build context, so writing the digest back does not change it.

release-please's release commit does not follow the project's own conventions:
its body carries the changelog, which does not wrap to 72 columns. The
`.wrapscallion.toml` at the repository root lists an `ignore` pattern that skips
it, so the `commit-messages` check passes the release without special-casing the
workflow.

[immutable]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-immutable-releases
[release-please]: https://github.com/googleapis/release-please
