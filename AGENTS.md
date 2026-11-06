# Working on KubeDeck

KubeDeck is a Kubernetes dashboard that runs as an Electron desktop app or as a shared web service
(web mode, behind a login proxy). One Express server serves the React client and talks to clusters
through `kubectl`.

## Commands

| | |
|---|---|
| `npm run dev` | server + client with hot reload (desktop mode) on `PORT` (default 5000) |
| `npm run electron:dev` | the desktop app |
| `npm test` | vitest (server and client) |
| `npm run check` | TypeScript |
| `npm run build` | production bundle in `dist/` |
| `script/docker-build.sh [--push]` | web image; `--push` builds linux/amd64 + linux/arm64 |

Web mode locally: `KUBEDECK_MODE=web KUBEDECK_AUTH=none KUBEDECK_PUBLIC_URL=http://localhost:5051 PORT=5051 npm run dev`
(see `docs/WEB.md` for every setting).

## Where things are

- `server/`: Express routes, one module per area (`*-routes.ts`). `kubectl-run.ts` runs kubectl,
  `kubectl-safety.ts` classifies commands, `web-mode.ts` is the login gate and feature switches,
  `identity.ts` the per-user impersonation, `map.ts` the namespace graph, `ai/` the assistant
  (AI SDK agent, tools, prompts).
- `client/src/`: pages in `pages/`, shared UI in `components/`, data hooks in `hooks/use-k8s.ts`,
  the assistant in `ai/`. Resource kinds in the sidebar come from `lib/resource-kinds.ts`.
- `shared/`: route definitions and schemas used by both sides.
- `deploy/kubernetes/`, `docs/`: web-mode manifest and runbooks.

## Rules

- Never run kubectl through a shell. Build argument arrays (`spawnCommand`, `runKubectlRaw`); route
  parameters are validated in `server/security.ts`. Every kubectl spawn goes through `asUser()` so
  per-user impersonation applies.
- Anything a shared web server runs must keep users inside its identity: no `config`, `auth`,
  `exec`, `--as`, `--token`… from the palette or the assistant (`webExecAllowed`, `webAgentRefusal`).
- Never add a `HEALTHCHECK` to the Dockerfile; probes live in the pod spec.
- Tests run against real code; no mocked LLMs or clusters.

## Understanding the code

Use [ripwire](https://github.com/redhat-et/ripwire) to map the code before reading files:
`ripwire . --for="<task>"` to find where to start, `--impact=SYMBOL` before changing something
widely used, `--quality-delta` before calling work done.
