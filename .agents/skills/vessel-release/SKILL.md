---
name: vessel-release
description: Prepare or manually publish a Vessel release with an annotated Git tag and Linux amd64 API/web images in skorcius/vessel on Docker Hub. Use for Vessel version bumps, release checks and publication, not live installation upgrades.
---

# Vessel release

Read `AGENTS.md`, `CHANGELOG.md`, `deploy/README.md` and the Release images
section of `docs/development.md` first.

## Release destination and scope

- Releases are manual. Docker Hub repository `skorcius/vessel` is the image
  destination, managed at
  <https://hub.docker.com/repository/docker/skorcius/vessel/general>.
- One version produces Git tag `vX.Y.Z` and two Linux amd64 images,
  `skorcius/vessel:api-X.Y.Z` and `skorcius/vessel:web-X.Y.Z`. The moving tags are
  `api-latest` and `web-latest`.
- Preparing a release does not authorize registry publication or deployment.
  Keep images local and give the owner the push commands unless publication
  was explicitly requested. Do not add CI publishing or create a GitHub Release
  unless requested. A Git tag and a GitHub Release are separate things.
- Never apply migrations to the owner's database, load the development `.env`
  into release checks, or change running installations for a release.

## Prepare the source

1. Inspect the worktree, fetch origin and tags, and confirm the intended commit
   and version. Preserve unrelated work. Check local and remote tags before
   creating one. Never move or overwrite an existing release tag or published
   versioned image.
2. Read changes since the preceding release tag. Write a dated changelog from
   those changes, including migration names, upgrade requirements and known
   limits. Preserve historical changelog entries and historical project notes.
3. Keep the version in step across:
   - `frontend/package.json`
   - `backend/Directory.Build.props`
   - all `ARG VERSION` defaults in both Dockerfiles
   - `deploy/compose.yaml` image fallbacks and `deploy/.env.example`
   - current release examples in `README.md`, `deploy/README.md` and
     `docs/development.md`
4. Do not change dependencies, regenerate lockfiles unnecessarily or expand
   product scope. Use the root-pinned pnpm through Corepack if needed.

## Verify

- Run `scripts/check.sh` with pinned pnpm on `PATH`. Set `Vessel_TEST_POSTGRES`
  to a disposable synthetic PostgreSQL 18 instance so database tests run.
  Never use the owner's connection. Report opt-in live-test skips separately.
- Run `python3 scripts/verify-release.py`. It builds throwaway images and tests
  HTTP/TLS proxy trust, headers, compression, SSE, upload limits and isolated
  backup/restore. Let its cleanup finish. If a check fails, stop before tagging
  or publication and report the failure.
- When an existing Playwright installation is available, use the documented
  `--browser-module` option for the production-image CSP smoke check. Do not
  install a new browser dependency just for a release.
- Review the diff and version consistency. Commit all release source changes
  before building final images so their revision labels identify that source.
  Use the project's normal PR flow when source review is required.

## Build and tag

Set `VERSION` to the requested version without `v`, and run from the clean
release checkout. Build both images from the same committed revision:

```sh
REVISION=$(git rev-parse HEAD)
docker build --platform linux/amd64 -f backend/Dockerfile \
  --build-arg VERSION="$VERSION" --build-arg REVISION="$REVISION" \
  -t "skorcius/vessel:api-$VERSION" .
docker build --platform linux/amd64 -f frontend/Dockerfile \
  --build-arg VERSION="$VERSION" --build-arg REVISION="$REVISION" \
  -t "skorcius/vessel:web-$VERSION" .
```

The API image includes `/app/migrate`; startup never runs migrations. No build
needs application credentials or a live database. Keep `.dockerignore` secret
exclusions intact and never pass keys or tokens as build arguments.

Inspect only selected image metadata to verify `linux/amd64`, the version and
revision labels, and inspect packaged application version metadata. Do not
dump environments or Docker credential configuration. After verification,
create an annotated `v$VERSION` tag on `$REVISION`. Push the branch and tag when
the request authorizes remote Git updates, without force or `--tags`.

## Manual publication

Use the owner's existing registry authentication. Never ask for a registry
password in chat, print credentials or store them in the repository. If
authentication is missing, hand back the verified local images and commands.
Only publish when the user has authorized it:

```sh
docker push "skorcius/vessel:api-$VERSION"
docker push "skorcius/vessel:web-$VERSION"
# Move latest only after both versioned pushes succeed.
docker tag "skorcius/vessel:api-$VERSION" skorcius/vessel:api-latest
docker tag "skorcius/vessel:web-$VERSION" skorcius/vessel:web-latest
docker push skorcius/vessel:api-latest
docker push skorcius/vessel:web-latest
```

Record the returned digests and verify remote image architecture and metadata.
If either versioned push fails, leave remote latest tags alone. If a latest push
fails, report the partial publication rather than claiming success or deleting
the successful images.

Report the source commit, Git tag and remote status, tests and skips, image
tags and whether they are local or published, and the operator's next step.
Release preparation or publication never means a live installation was upgraded.
