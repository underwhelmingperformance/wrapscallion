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

To cut a release, run the `release` workflow from the Actions tab with the new
version (for example `0.2.0`). It runs `deno task check`, then:

- builds the multi-architecture Docker image and pushes it to the GitHub
  Container Registry by digest, with a build-provenance attestation;
- pins the pre-commit `wrapscallion` hook to that digest and sets the package
  version;
- creates the release commit through the GitHub API (so GitHub signs it), points
  the `vX.Y.Z` tag at it, and publishes the immutable release.

The release commit is reachable only through the tag — `main` is not moved — so
the pipeline never has to bypass branch protection, and the tag carries a
verified signature. A consumer pinning `rev: vX.Y.Z` runs exactly the image
built from that tag; the image is not part of its own build context, so writing
the digest back does not change it.

[immutable]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-immutable-releases
