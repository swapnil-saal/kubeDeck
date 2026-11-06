<p align="center">
  <img src="build/icon_source.png" width="128" alt="KubeDeck logo" />
</p>

<h1 align="center">KubeDeck</h1>
<p align="center">A Kubernetes navigator for the desktop or as a shared web service: browse clusters and resources, look inside pods, run kubectl, and investigate problems with a built-in AI operator.</p>

<p align="center">
  <a href="https://github.com/swapnil-saal/kubeDeck/releases/latest">
    <img alt="Download" src="https://img.shields.io/github/downloads/swapnil-saal/kubeDeck/total?style=flat-square&logo=apple&label=Download%20DMG" />
  </a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Docker-blue?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-40-47848F?style=flat-square&logo=electron" />
</p>

---

## Download

> **macOS Apple Silicon (arm64, macOS 13+)**, **Windows** (installer or portable), and a **Docker image** for the web version (amd64 + arm64)

👉 **[Download the latest release](https://github.com/swapnil-saal/kubeDeck/releases/latest)**

**macOS:** download the `.dmg`, drag **KubeDeck** to Applications, then right-click → **Open** on first launch (unsigned build).
**Windows:** run the NSIS installer, or use the portable `.exe`.
**Web:** `docker pull swapnilsaal/kubedeck:<version>-web` and see [Web version](#web-version).

---

## Features

| Feature | Description |
|---|---|
| 🌐 **Multi-cluster** | Switch between all contexts in your `~/.kube/config` |
| 📦 **Resource types** | Pods, Deployments, Services, ConfigMaps, Secrets, Ingresses, StatefulSets, DaemonSets, Jobs, CronJobs, HPAs, PersistentVolumeClaims, and Nodes |
| 🔍 **Resource detail** | Full YAML view, metadata, labels, annotations, and status |
| 🏠 **Overview** | What needs attention, an activity timeline of rollouts, scaling and warnings, and capacity at a glance |
| 📋 **Pod logs** | Stream live logs directly from any pod container |
| 🗂️ **Pod files** | Browse a container's file tree, view and search files, download a file or a whole folder (.tar.gz) |
| 🤖 **AI operator** | Chat with an agent that has live, read-mostly kubectl access: it inspects the cluster, shows dashboards, and asks for your approval before any mutating command. Works with OpenAI, Anthropic, Ollama, or any OpenAI-compatible gateway |
| 🧵 **Traces and log history** | With Grafana Tempo: each workload's endpoints with requests, errors and p95, a rollout check (new version vs old), per-service health in Overview → Traces, and a span waterfall. With Loki, the pod's log lines at the moment of a request sit next to the span, and the AI operator can read log history of pods that are gone. Grafana (Prometheus, dashboards, alerts) through the Grafana MCP server |
| 🔐 **Permission-aware** | Shows only what your account may do: kinds you cannot list leave the sidebar, actions you cannot take are not offered |
| 🩺 **Cluster pulse** | Live health score and a list of what is broken right now (crashing pods, image-pull errors, degraded deployments, NotReady nodes), each one click from an AI diagnosis |
| 🔌 **Port forwarding** | Start, test, and stop `kubectl port-forward` sessions from the UI (desktop only) |
| ⌘K **kubectl palette** | Run kubectl or describe what you want in plain English |
| 🗂️ **Multiple kubeconfigs** | Point KubeDeck at several kubeconfig files in Settings |
| 🎨 **Themes** | Several light and dark palettes, remembered on your device (defaults: OLED black and Paper) |
| ⚡ **Fast** | Electron + Vite + React with route-level code splitting, no cloud dependency on the desktop |

---

## Web version

KubeDeck also runs as a shared web service behind your login (oauth2-proxy / Keycloak), with the desktop app's features: changes, the AI assistant and pod files are on by default and can each be switched off (`KUBEDECK_READ_ONLY=true`, `KUBEDECK_AI=off`, `KUBEDECK_POD_FILES=off`). Port-forward is desktop only. The AI provider comes from the server's environment; users act through the server's service account, so its RBAC is the limit.

```sh
docker pull swapnilsaal/kubedeck:<version>-web    # linux/amd64 + linux/arm64, runs as non-root (uid 1000)
```

See [docs/WEB.md](docs/WEB.md), the deployment runbook [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and `deploy/kubernetes/`.

## Screenshots

> The app pulls real data from your local kubeconfig — no screenshots included to avoid leaking cluster info.

---

## Requirements

- macOS 13+ (Apple Silicon / arm64)
- `kubectl` installed and available in your PATH (e.g. via Homebrew: `brew install kubectl`)
- A valid `~/.kube/config` with at least one context

KubeDeck reads your full shell environment (including `KUBECONFIG` set in `.zshrc` / `.bashrc`) automatically.

---

## Tech Stack

- **Electron 40** — native desktop shell
- **React 18 + Vite** — frontend
- **Vercel AI SDK + assistant-ui** — the AI chat and agent
- **Express 5** — local API server (bundled inside the app)
- **Tailwind CSS + shadcn/ui** — UI components
- **kubectl CLI** — all K8s operations (shell out, no SDK dependency)

---

## Development

### Prerequisites

```bash
brew install node kubectl
```

### Setup

```bash
git clone https://github.com/swapnil-saal/kubeDeck.git
cd kubeDeck
npm install
```

### Run in dev mode

```bash
npm run electron:dev
```

This builds the Vite frontend + Express server bundle and launches Electron.

### Build installers

```bash
npm run package              # macOS: release/KubeDeck-<version>-arm64.dmg
npm run package:win          # Windows NSIS installer + portable (also built by CI on windows-latest)
```

> The build runs a deep ad-hoc re-sign (`codesign --deep --force --sign -`) after packaging to satisfy macOS 26.x Team ID enforcement.

---

## Project Structure

```
├── client/          # React frontend (Vite)
│   └── src/
│       ├── pages/   # Dashboard, ResourceDetail, Settings
│       ├── components/
│       └── ai/      # AI chat, cluster pulse and inline AI actions (import via "@/ai")
├── server/          # Express API server
│   ├── routes.ts    # mounts the route modules (*-routes.ts): resources, actions, pod files, logs…
│   ├── web-mode.ts  # web mode: login gate, feature switches, read-only, audit
│   ├── security.ts  # loopback / same-origin guard for the API
│   └── ai/          # providers, one-shot endpoints and the streaming agent (entry: registerAiRoutes)
├── electron/
│   └── main.cjs     # Electron main process
├── build/
│   ├── afterSign.cjs        # Post-sign hook for ad-hoc re-signing
│   ├── icon.icns            # macOS app icon
│   └── icon_source.png      # Source icon (1000×1000)
└── shared/          # Shared types/schema
```

---

## License

MIT © [Swapnil Saal](https://github.com/swapnil-saal)
