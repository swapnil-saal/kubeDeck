# Working on KubeDeck

KubeDeck is a Kubernetes dashboard that runs as an Electron desktop app or as a shared web service
(web mode, with its own sign-in). One Express server serves the React client and talks to clusters
through `kubectl`.

## Commands

| | |
|---|---|
| `npm run dev` | server + client with hot reload (desktop mode) on `PORT` (default 5000) |
| `npm run electron:dev` | the desktop app |
| `npm test` | vitest: every test under `tests/` (mirrors `server/`, `client/src`, `shared/`; see `tests/README.md`), including the architecture check |
| `npm run check:arch` | only the architecture check (`tests/architecture.test.ts`) |
| `npm run check` | TypeScript |
| `npm run build` | production bundle in `dist/` |
| `script/docker-build.sh [--push]` | web image; `--push` builds linux/amd64 + linux/arm64 |
| `npm run docs:dev` / `npm run docs:build` | the documentation site (docmd, `documentation/`), served by KubeDeck at `/docs`; `npm run build` builds it too |

Web mode locally: `KUBEDECK_MODE=web KUBEDECK_PUBLIC_URL=http://localhost:5051 KUBEDECK_AUTH_SECRET=<32+ chars> KUBEDECK_ADMIN_EMAIL=… KUBEDECK_ADMIN_PASSWORD=… PORT=5051 npm run dev`
(see `docs/WEB.md` for every setting).

## Where things are

- `server/`: Express routes, one module per area (`*-routes.ts`). `kubectl-run.ts` runs kubectl,
  `kubectl-safety.ts` classifies commands, `web-mode.ts` is the login gate and feature switches,
  `identity.ts` whom each kubectl call runs as (per cluster: the person's group's service account, else per-user impersonation), `events/` the typed in-process event bus (modules emit
  facts such as `action.done` and `user.changed`, others subscribe; no direct calls between them),
  `audit/` the audit log (subscribes to `action.done`; the desktop app keeps it too, in
  `~/.kubedeck/kubedeck.db`, under one local user who never signs in), `db/` the database,
  `auth/` web mode's sign-in (Better Auth, loaded only in web mode), `groups/` KubeDeck groups and the service account each uses per cluster (impersonated, or an uploaded kubeconfig kept encrypted), `projects/` projects (shared, in the database), `map.ts` the namespace graph, `tempo.ts` +
  `traces-routes.ts` traces from Grafana Tempo, `loki.ts` log history, `mcp/` the MCP hub (the only MCP client; remote servers only, no stdio) with the Grafana plugin (read tools
  only, the `grafana` tool) and added MCP server plugins (one `mcp_<name>` tool each), `ai/` the assistant (AI SDK agent, prompts; `ai/tools/` is the tool registry: each module calls `registerTools(owner, …)` with its tools, their risk and a per-call `forCall` for availability, descriptions and prompt sections; the agent only reads the registry). Web mode's sign-in lives in
  `auth/` (the only code that knows Better Auth; admin routes validate groups), `db/` is the database (Kysely: SQLite via
  `node:sqlite`, or Postgres; each module owns its tables, migrations in `db/migrations.ts`), `audit/` the audit log.
  The desktop app never loads `auth/` or `db/` (dynamic imports only).
- `client/src/`: pages in `pages/`, shared UI in `components/`, data hooks in `hooks/use-k8s.ts`,
  the assistant in `ai/`. Resource kinds in the sidebar come from `lib/resource-kinds.ts`.
- `shared/`: route definitions and schemas used by both sides.
- `deploy/kubernetes/`, `docs/`: web-mode manifest and runbooks.
- `documentation/`: the user-facing documentation site (pages in `pages/`, sidebar in `docmd.config.json`, style in `AUTHORING.md`). A feature change that users see updates its page there.

## Rules

- Never run kubectl through a shell. Build argument arrays (`spawnCommand`, `runKubectlRaw`); route
  parameters are validated in `server/security.ts`. Every kubectl spawn goes through `asUser()` so
  per-user impersonation applies.
- Anything a shared web server runs must keep users inside its identity: no `config`, `auth`,
  `exec`, `--as`, `--token`… from the palette or the assistant (`webExecAllowed`, `webAgentRefusal`).
- Never add a `HEALTHCHECK` to the Dockerfile; probes live in the pod spec.
- Tests live in `tests/`, mirroring the code, and import it through aliases (`@server/…`, `@/…`, `@shared/…`, helpers from `@tests/support/…`). They run against real code; no mocked LLMs or clusters.

### Architecture rules

Only gateways reach outside, each module has one front door, each module owns its tables.
`tests/architecture.test.ts` enforces this on every `npm test` (and in CI); a failure names the
file, the import, the rule and the fix. Allowlists in that file hold today's exceptions, each with
a reason: fix the code rather than growing them.

- `client/src` never imports `server/`, `server/` never imports `client/`, `shared/` imports neither.
- Gateway-only packages: `better-auth` in `server/auth`; `kysely`, `pg`, `node:sqlite` in `server/db`;
  `@ai-sdk/mcp` in `server/mcp`; `ai` in `server/ai` and `client/src/ai`;
  `@ai-sdk/*` providers in `server/ai`; `@ai-sdk/react` and `@assistant-ui/*` in `client/src/ai`.
- `child_process` only in the files listed in `CHILD_PROCESS_ALLOWED`; every spawn there passes its
  arguments through `asUser()` and none uses a shell.
- `server/auth`, `server/db`, `server/audit`, `server/events`, `server/ai/tools`, `server/plugins`, `server/mcp`, `server/groups`, `server/projects`: code outside the
  folder imports only its `index.ts`.
- A table is queried only by its owner (`TABLE_OWNERS`: `audit_log` → `server/audit`, `kubedeck_group` and `group_cluster_access` → `server/groups`, `project` → `server/projects`); Better Auth's
  tables only by Better Auth. A new table needs an entry there.

## Understanding the code

Use [ripwire](https://github.com/redhat-et/ripwire) to map the code before reading files:
`ripwire . --for="<task>"` to find where to start, `--impact=SYMBOL` before changing something
widely used, `--quality-delta` before calling work done.
