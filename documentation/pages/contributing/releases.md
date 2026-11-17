---
title: "Releases"
description: "How a KubeDeck release is made: the version in package.json, the multi-arch web image, the macOS and Windows desktop builds, and the Windows workflow that runs on tags."
---

# Releases

A KubeDeck release has three outputs: the macOS desktop app, the Windows desktop app, and the web-mode Docker image. All three take their version from `package.json`. This page describes the scripts and the workflow that produce them.

## The version

The version lives in one place, the `version` field of `package.json` (for example `2.0.0`). Everything else reads it:

| Output | Name |
| --- | --- |
| Docker image | `swapnilsaal/kubedeck:<version>-web` |
| macOS and Windows files | Named by electron-builder from the product name and version, in `release/` |
| Git tag | `v<version>`, e.g. `v2.0.0` |
| GitHub release | Created for the tag by the Windows workflow if it does not exist yet |

Bump the version in `package.json` (and `package-lock.json`, which `npm version` updates for you) before you build anything for a release. Update the image tag in `deploy/kubernetes/kubedeck.yaml` to match.

## The web image

`script/docker-build.sh` builds the image from the `Dockerfile`:

```bash
script/docker-build.sh           # local build for this machine
script/docker-build.sh --push    # linux/amd64 + linux/arm64, pushed as one tag
```

| Command | What it does |
| --- | --- |
| `script/docker-build.sh` | `docker build -t swapnilsaal/kubedeck:<version>-web .` for your machine's platform, then removes every other local `swapnilsaal/kubedeck` image and dangling layers, and prints the one it kept |
| `script/docker-build.sh --push` | `docker buildx build --platform linux/amd64,linux/arm64 … --push`, then prints the pushed platforms. Needs `docker login` |

Most clusters run amd64 nodes, while a Mac builds arm64 by default, so a release uses `--push`.

What the Dockerfile does:

- Builds once on the build machine's platform with `KUBEDECK_BUNDLE_ALL=1 npm run build`, which bundles every runtime dependency into `dist/index.cjs`.
- Uses `node:22-alpine` for the runtime and downloads `kubectl` for the target architecture (`KUBECTL_VERSION` build argument).
- Sets `KUBEDECK_MODE=web`, `PORT=5000` and `NODE_ENV=production`, runs as uid `1000`, and exposes port 5000.
- Has no `HEALTHCHECK`. Liveness and readiness live in the pod spec. Do not add one.

To push to your own registry instead:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t registry.example.com/kubedeck:<version>-web --push .
```

## The desktop apps

The desktop apps are packaged with electron-builder, configured in `electron-builder.yml`. Output goes to `release/`.

| Script | Builds |
| --- | --- |
| `npm run package` | macOS: a `.dmg` and a `.zip` |
| `npm run package:dir` | macOS: the unpacked app only, for a quick check |
| `npm run package:win` | Windows: an NSIS installer and a portable `.exe` |

Each script runs `npm run build` first. The bundle (`dist/`), `electron/`, `node_modules/` and `package.json` go into the app.

### macOS

- The app is not signed with a developer identity (`identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false`).
- `build/afterPack.cjs` ad-hoc signs the `.app` (`codesign --force --deep --sign -`) with `build/entitlements.mac.plist`, before the DMG and ZIP are made. Without it, macOS on Apple Silicon reports the app as damaged.
- People open it the first time with right-click → **Open**.

No workflow in `.github/workflows` builds the macOS app. Build it on a Mac with `npm run package`.

### Windows

- Targets: `nsis` (lets the user choose the install folder, per user) and `portable`.
- `npmRebuild: false`: there are no required native add-ons, so Windows CI does not need Visual Studio.

## The Windows workflow

`.github/workflows/windows.yml` runs on every pushed tag that starts with `v`, and can also be started by hand (`workflow_dispatch`). On `windows-latest` with Node 20 it:

::: steps
::: step "Installs and packages"
Runs `npm ci`, then `npm run package:win`.
::: /step
::: step "Uploads the files as a workflow artifact"
`release/*.exe` and `release/*.exe.blockmap`, named `KubeDeck-windows`.
::: /step
::: step "Attaches them to the GitHub release"
For a tag, the release named by the tag. When started by hand, `v<version>` from `package.json`. If the release exists, the files are uploaded with `--clobber`. If not, the workflow creates it with generated notes and the title `KubeDeck <tag>`.
::: /step
::: /steps

## CI on every change

`.github/workflows/ci.yml` runs on every push and pull request to `master` and `develop`, on Ubuntu with Node 22: `npm ci`, `npm run check`, `npm test` and `npm run build`. A release should come from a commit where it passed.

## Checklist

::: steps
::: step "Set the version"
Bump `version` in `package.json`, and the image tag in `deploy/kubernetes/kubedeck.yaml`.
::: /step
::: step "Check"
`npm run check` and `npm test` pass.
::: /step
::: step "Tag and push"
Tag the commit `v<version>` and push the tag. The Windows workflow builds and attaches the Windows files.
::: /step
::: step "Build macOS"
On a Mac, `npm run package`, then add the `.dmg` to the release.
::: /step
::: step "Push the image"
`script/docker-build.sh --push`.
::: /step
::: /steps

## Related

- [Development setup](/contributing/development)
- [Run with Docker](/web/docker)
- [Deploy on Kubernetes](/web/deploy-kubernetes)
