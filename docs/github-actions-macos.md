# GitHub Actions macOS Build Guide

This project now includes GitHub Actions workflows for automatic macOS builds.

## Workflows

### 1. Continuous macOS build

File:

- `.github/workflows/macos-build.yml`

Triggers:

- push to `main`
- push to `master`
- pull request
- manual `workflow_dispatch`

What it does:

1. Checks out the repository
2. Installs Node.js and pnpm
3. Installs dependencies with `pnpm install --frozen-lockfile`
4. Runs `pnpm build:mac`
5. Uploads the generated macOS artifacts to the workflow run

Uploaded artifacts include:

- `.dmg`
- `.zip`
- `.blockmap`
- `latest-mac.yml`

### 2. Release build

File:

- `.github/workflows/macos-release.yml`

Triggers:

- Git tag push matching `v*`
- GitHub Release `published`
- manual `workflow_dispatch`

What it does:

1. Builds the macOS package
2. Prints the `dist/` directory in workflow logs
3. Verifies that both `.dmg` and `.zip` were generated
4. Uploads the build artifacts to the workflow run
5. If triggered by a tag or published Release, uploads the DMG and ZIP files to GitHub Releases

## Node 24 compatibility

GitHub has deprecated the Node.js 20 runtime for JavaScript-based actions.

These workflows now address that in two ways:

- `actions/checkout` is upgraded to `v6`
- `actions/setup-node` is upgraded to `v6`
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` is set at workflow level

This follows GitHub's Node 20 deprecation guidance:

- https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

Reference action releases:

- `actions/checkout@v6`: https://github.com/actions/checkout/releases
- `actions/setup-node@v6`: https://github.com/actions/setup-node/releases

## Recommended release process

Create a release tag like this:

```bash
git tag v1.0.1
git push origin v1.0.1
```

That will trigger `.github/workflows/macos-release.yml` and attach the build artifacts to a GitHub Release automatically.

You can also publish a GitHub Release from the repository UI. The workflow now listens to the `release.published` event and uploads the generated DMG and ZIP files to that Release.

## Why the release workflow uploads files explicitly

The packaged files in this project include spaces in filenames, for example:

```text
Lume GUI-1.0.0-arm64.dmg
```

To reduce ambiguity around file globbing inside release wrapper actions, the workflow now:

1. lists the actual files in `dist/`
2. validates that `.dmg` and `.zip` exist
3. uploads release assets with `gh release upload --clobber`

This is more predictable than relying only on `files: dist/*.dmg` in a third-party action.

## Notes about the current build mode

The GitHub workflows use the same local packaging strategy as this repository:

- macOS only
- arm64 only
- ad-hoc signing
- no Apple notarization

That means the produced app is suitable for free open-source distribution, but users may still need to open it through Finder `Open` or `Privacy & Security > Open Anyway` on first launch.

## If you later join the Apple Developer Program

You can upgrade these workflows later by adding GitHub repository secrets for:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `CSC_NAME`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Then you can switch the workflow build command from ad-hoc packaging to a Developer ID signed and notarized build.
