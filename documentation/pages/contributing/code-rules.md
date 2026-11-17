---
title: "Code rules"
description: "The rules every KubeDeck change follows: kubectl without a shell and as the user, gateways, front doors, table owners, and the architecture test that enforces them."
---

# Code rules

KubeDeck runs `kubectl` for many people from one server, so a few rules are not style preferences: they keep each person inside their own identity. The rest keep the code in modules you can change one at a time. Most of them are checked by `tests/architecture.test.ts` on every `npm test` and in CI.

## kubectl: argument arrays, never a shell

Never run kubectl through a shell. Build an argument array and use the gateway in `server/kubectl-run.ts`:

- `spawnCommand(cmd, args, env)` for a command you build as an array.
- `runKubectlRaw(command)` for a fixed command string. It splits on whitespace; it does not interpret quotes, pipes or variables.

Route parameters (names, namespaces, contexts) end up in those arrays, so they are validated first, in `server/security.ts` (`registerParamValidators`, `validateK8sQuery`, `findInvalidParam`). A new route parameter that reaches kubectl needs the same validation.

The assistant's `bash` tool is the one place that accepts pipelines, and `server/kubectl-safety.ts` allows only `kubectl` plus text filters such as `jq`, `grep` and `awk` in them. In web mode the pipeline runs without a shell: `executePipeline` in `server/ai/chat/kubectl.ts` spawns each stage directly and refuses `;`, `&&`, `||`, `$( )` and backticks. On the desktop it runs with `sh -c`, as the desktop user.

## Every spawn goes through asUser()

Every kubectl process passes its arguments through `asUser()` from `server/identity.ts`. That is what adds the person's identity: in web mode, their groups' service accounts on the call's cluster (impersonated through the cluster's connection, or a group's uploaded kubeconfig); on the desktop, nothing, so the desktop user's own kubeconfig applies. In web mode `KUBECONFIG` points at an empty file, so a spawn that skips it reaches no cluster.

You do not pass the identity around. It rides on the request's async context and reaches calls made deep inside handlers and the assistant's tools.

Only the files listed in `CHILD_PROCESS_ALLOWED` in the architecture test may import `child_process`:

| File | Why |
| --- | --- |
| `server/kubectl-run.ts` | The kubectl gateway |
| `server/pod-files.ts` | Streams files in and out of a container with `kubectl exec` and `tar` |
| `server/pod-files-routes.ts` | Pipes a `kubectl exec` download into the HTTP response |
| `server/log-routes.ts` | Follows `kubectl logs -f` |
| `server/log-fetch.ts` | Reads logs with `kubectl logs` |
| `server/port-forward-routes.ts` | Keeps a `kubectl port-forward` process alive |
| `server/ai/chat/kubectl.ts` | The assistant's kubectl tool |

The test also fails when a spawn in these files skips `asUser()` or sets a `shell` option to anything but `false`.

## Keep users inside their identity

Anything a shared web server runs must keep people inside their own identity. In web mode, neither the kubectl palette nor the assistant may run:

- the verbs `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach`, `debug`;
- the flags `--kubeconfig`, `--token`, `--server`, `--as`, `--as-group`, `--as-uid`, `--user`, `--cluster`, the client certificate and key flags, and the other credential flags.

The checks are `webExecAllowed` (the palette) and `webAgentRefusal` (the assistant) in `server/web-mode.ts`. If you add a way to run commands, route it through them.

## Gateways: one module per outside library

Only one place may load each outside library. Everything else calls what that module exports.

| Package | Only in |
| --- | --- |
| `better-auth` | `server/auth` |
| `kysely`, `pg`, `node:sqlite` | `server/db` |
| `@ai-sdk/mcp` | `server/mcp` |
| `ai` | `server/ai`, `client/src/ai` |
| `@ai-sdk/*` model providers | `server/ai` |
| `@ai-sdk/react`, `@assistant-ui/*` | `client/src/ai` |

The desktop app never loads `server/auth` (dynamic import only, in web mode).

## Front doors: import a module's index only

These folders are modules. Code outside a folder imports only its `index.ts`:

`server/auth`, `server/db`, `server/audit`, `server/events`, `server/ai/tools`, `server/plugins`, `server/observability`, `server/mcp`, `server/groups`, `server/projects`.

If you need something from inside, export it from the module's `index.ts`. The list of exceptions (`FRONT_DOOR_EXCEPTIONS`) is empty; keep it that way.

## Modules talk through events

Modules do not call each other to report what happened. The module that acts emits an event on `server/events`; the modules that care subscribe. For example, every write emits `action.done` and the audit module stores it. Add a new event to `EventMap` in `server/events/index.ts` first.

## Each table has one owner

A table is queried only by the module that owns it. `TABLE_OWNERS` in the architecture test lists them:

| Table | Owner |
| --- | --- |
| `audit_log` | `server/audit` |
| `plugin_state` | `server/plugins` |
| `kubedeck_group`, `group_cluster_access` | `server/groups` |
| `project` | `server/projects` |
| `user`, `session`, `account`, `verification` | Better Auth only |

A new table needs a migration in `server/db/migrations.ts` and an entry in `TABLE_OWNERS`. Never edit a migration that has shipped: add a new one.

## Client, server and shared stay apart

- `client/src` never imports `server/`.
- `server/` never imports `client/`.
- `shared/` imports neither.

Put types and schemas both sides need in `shared/`.

## The architecture test

```bash
npm run check:arch
```

It parses every source file under `server/`, `client/src/` and `shared/` with the TypeScript parser and fails on any crossing. The failure names the file, the import, the rule and the fix.

The allowlists in the test hold today's exceptions, each with a reason. Fix the code rather than growing them. When an exception is truly right, add it with a reason that would convince a reviewer.

## Other rules

- **Tests use real code.** No mocked LLMs, clusters or APIs.
- **No `HEALTHCHECK` in the Dockerfile.** KubeDeck runs on Kubernetes, where probes live in the pod spec (`/healthz`).

## Related

- [Architecture](/reference/architecture)
- [Development setup](/contributing/development)
- [Security model](/web/security)
