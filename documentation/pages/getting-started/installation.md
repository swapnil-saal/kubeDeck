---
title: "Installation"
description: "Install the KubeDeck desktop app on macOS or Windows, run it from source, or find the web image."
---

# Installation

KubeDeck runs as a desktop app on your machine, using your own kubeconfig. Install it from a release build, or run it from source if you want to change it. A team that wants one shared KubeDeck runs the web image instead.

## Requirements

- `kubectl` installed and on your `PATH`. KubeDeck runs every cluster operation through `kubectl`; it has no Kubernetes client library of its own.
- A kubeconfig with at least one context. KubeDeck reads `~/.kube/config` by default. You can add more files later in **Settings → Clusters** (see [Clusters and namespaces](/guide/clusters-and-namespaces)).

::: callout info title:"macOS and your shell PATH"
Apps started from Finder do not get your shell's `PATH`. The packaged macOS app asks your login shell for its `PATH` at start, so a `kubectl` installed with Homebrew is found.
:::

## Download the desktop app

Release builds are on the [latest GitHub release](https://github.com/swapnil-saal/kubeDeck/releases/latest).

::: tabs
::: tab "macOS"
The macOS build is for Apple Silicon (arm64). It comes as a `.dmg` and as a `.zip`.

1. Download the `.dmg` and open it.
2. Drag **KubeDeck** to **Applications**.
3. The app is not signed with an Apple developer certificate. On first launch, right-click **KubeDeck** in Applications and choose **Open**.

If macOS still refuses, open **System Settings → Privacy & Security** and choose **Open Anyway** for KubeDeck.
::: /tab
::: tab "Windows"
The Windows build comes in two forms:

- **Installer** (NSIS): installs for your user only, and lets you choose the install folder.
- **Portable** `.exe`: runs without installing anything.

Make sure `kubectl.exe` is on your system `PATH` before you start KubeDeck.
::: /tab
::: /tabs

## First launch

KubeDeck starts a local server on `127.0.0.1` and opens its window on it. In desktop mode it does not listen on other network interfaces.

On first start it reads the contexts in your kubeconfig and selects the kubeconfig's current context. If it cannot read any context, the Overview shows **Could not load cluster contexts** with kubectl's error, a **Retry** button and a link to **Settings**.

The kubeconfig files you list in **Settings → Clusters** are saved in `~/.kubedeck/settings.json`.

Continue with the [desktop quick start](/getting-started/quick-start).

## Run from source

You need Node.js 22 (the version CI and the Docker image use) and `kubectl`.

```bash
git clone https://github.com/swapnil-saal/kubeDeck.git
cd kubeDeck
npm install
```

Then pick how you want to run it:

| Command | What it does |
|---|---|
| `npm run dev` | Server and client with hot reload, in desktop mode, on `http://127.0.0.1:5000`. Open it in your browser. |
| `npm run electron:dev` | The desktop window, with the same development server behind it. |

Both use port `5000` unless you set `PORT`:

```bash
PORT=5050 npm run dev
```

::: callout tip
To try the shared web mode from source, see [Quick start (shared web)](/getting-started/web-quick-start).
:::

More on the codebase is in [Development setup](/contributing/development).

## Web image

The shared web version ships as a Docker image for `linux/amd64` and `linux/arm64`:

```bash
docker pull swapnilsaal/kubedeck:<version>-web
```

It runs as a non-root user (uid `1000`) and needs a few environment variables before it starts. See [Run with Docker](/web/docker) and [Deploy on Kubernetes](/web/deploy-kubernetes).
