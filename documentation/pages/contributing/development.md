---
title: "Development setup"
description: "Clone KubeDeck, run it in desktop or web mode with hot reload, run the tests and the architecture check, and build the bundle and the docs."
---

# Development setup

KubeDeck is a TypeScript project: an Express server in `server/`, a React client in `client/src/`, shared schemas in `shared/`, and an Electron shell in `electron/`. One command runs the server and the client together with hot reload. This page gets you from a fresh clone to a running app and a green test run.

## What you need

- Node.js and npm. CI runs on Node 22, and the Docker image uses `node:22-alpine`.
- `kubectl` on your `PATH`. Some tests run it.
- A kubeconfig with at least one context to try the app against. A local cluster such as kind or Docker Desktop works well.

## Get the code

```bash
git clone https://github.com/swapnil-saal/kubeDeck.git
cd kubeDeck
npm install
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Server and client with hot reload, in desktop mode, on `PORT` (default `5000`). Open `http://localhost:5000` |
| `npm run electron:dev` | The desktop app: Electron starts the dev server and opens a window on it |
| `npm test` | Vitest: every test under `server/`, `client/src/` and `shared/`, including the architecture check |
| `npm run check:arch` | Only the architecture check (`tests/architecture.test.ts`) |
| `npm run check` | TypeScript (`tsc`) |
| `npm run build` | The production bundle in `dist/`: the client (Vite), the docs (docmd) and the server (`dist/index.cjs`, esbuild) |
| `npm start` | Runs the built bundle with `NODE_ENV=production` |
| `npm run package` | Builds, then packages the macOS app. See [Releases](/contributing/releases) |
| `npm run package:win` | Builds, then packages the Windows installer and portable app |
| `npm run docs:dev` | This documentation site with live preview |
| `npm run docs:build` | Builds the documentation into `dist/docs` (`npm run build` does this too) |

## Run web mode locally

Web mode needs a public URL, a session secret and a first admin. Run it on a different port so it does not clash with a desktop dev server:

```bash
KUBEDECK_MODE=web KUBEDECK_PUBLIC_URL=http://localhost:5051 \
KUBEDECK_AUTH_SECRET="$(openssl rand -base64 32)" \
KUBEDECK_ADMIN_EMAIL=you@example.com KUBEDECK_ADMIN_PASSWORD='choose-a-long-one' \
PORT=5051 npm run dev
```

Open `http://localhost:5051` and sign in.

::: callout info title:"Things to know"
- The admin password must be at least 12 characters.
- Web mode does not read your kubeconfig. Sign in, add a cluster in Settings → Clusters (for kind or Docker Desktop, `kubectl config view --minify --flatten --context=<context>` gives a kubeconfig with inline credentials), create a group with a service account on it, and add yourself to the group.
- `deploy/demo/kubedeck-demo.yaml` creates demo workloads and the service accounts `shop/shop-viewer` and `shop/shop-editor` to pick in a group.
- Without `KUBEDECK_DATABASE_URL`, web mode uses `~/.kubedeck/kubedeck.db`, the same file as the desktop app. Point it elsewhere to keep them apart, e.g. `KUBEDECK_DATABASE_URL=sqlite:/tmp/kubedeck-web.db`.
- A random `KUBEDECK_AUTH_SECRET` on each start signs everyone out and makes stored secrets unreadable. Keep one fixed value while you work.
:::

Every setting is listed in [Environment variables](/reference/environment-variables).

## Tests

```bash
npm test             # everything
npm run check:arch   # only the architecture rules
npm run check        # types
```

Tests run against real code. Do not mock the LLM, the cluster or the APIs KubeDeck talks to. When a change needs a live check, test it against a real cluster and a real model provider. Use a local cluster for anything that writes.

The architecture test parses every source file under `server/`, `client/src/` and `shared/` and fails when code crosses a boundary. Its message names the file, the import, the rule and the fix. See [Code rules](/contributing/code-rules).

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run check`, `npm test` and `npm run build` on Node 22 for every push and pull request to `master` and `develop`.

### Where tests live

Every test is under `tests/`, in a tree that mirrors the code, so the code folders hold only code:

| Folder | Tests for |
| --- | --- |
| `tests/server/…` | `server/…`: routes over real HTTP, modules against a real SQLite database |
| `tests/client/…` | `client/src/…`: the logic of pages, hooks and components |
| `tests/shared/…` | `shared/…` |
| `tests/architecture.test.ts` | the code rules |
| `tests/support/` | helpers: `memoryDatabase()`, `listen(app)`, `unreachableKubeconfig()` |

Tests import through aliases, never relative paths: `@server/groups`, `@/lib/projects` (client/src), `@shared/groups`, and helpers from `@tests/support/…`. Run one folder with `npx vitest run tests/server/groups`.

## Find your way around

| Path | What is there |
| --- | --- |
| `server/*-routes.ts` | Express routes, one module per area |
| `server/kubectl-run.ts` | Runs kubectl |
| `server/identity.ts` | Who each kubectl call runs as |
| `server/web-mode.ts` | Web mode's gate and feature switches |
| `server/ai/` | The assistant; `server/ai/tools/` is its tool registry |
| `server/plugins/`, `server/mcp/`, `server/observability/` | Plugins, MCP servers, Tempo and Loki |
| `client/src/pages/` | One component per page |
| `client/src/hooks/use-k8s.ts` | Data hooks |
| `client/src/lib/resource-kinds.ts` | Resource kinds in the sidebar |
| `shared/` | Route definitions and schemas used by both sides |
| `documentation/` | This site. Read `documentation/AUTHORING.md` before you write a page |

[Architecture](/reference/architecture) explains how the parts fit.

### Map the code before you read it

The repository's `AGENTS.md` suggests [ripwire](https://github.com/redhat-et/ripwire) to find where to start:

```bash
ripwire . --for="<task in words>"   # where to start
ripwire . --impact=SYMBOL           # before changing something widely used
ripwire . --quality-delta           # before calling work done
```

## Related

- [Code rules](/contributing/code-rules)
- [Releases](/contributing/releases)
