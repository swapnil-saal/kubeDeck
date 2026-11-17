---
title: "Environment variables"
description: "Every environment variable KubeDeck reads, which mode it applies to, its default and what it does."
---

# Environment variables

This page lists every environment variable KubeDeck's server, desktop shell and build script read. A web-mode server is configured almost entirely through these. The desktop app needs none of them, but reads most of them when they are set in the environment it starts in.

Mode means where the variable has an effect: **Desktop** (the Electron app), **Web** (`KUBEDECK_MODE=web`), or **Both**.

::: callout info title:"Switch values"
On/off switches accept `1`, `true`, `yes`, `on` and `0`, `false`, `no`, `off`, in any case. `KUBEDECK_DEBUG` is the exception: only `1` turns it on.
:::

## Mode and server

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBEDECK_MODE` | Both | unset (desktop) | `web` turns web mode on. The Docker image sets it to `web` |
| `PORT` | Both | `5000` | The port the server listens on. The desktop shell also uses it to open its window |
| `HOST` | Both | `127.0.0.1` on the desktop, `0.0.0.0` in web mode | The address the server binds to |
| `KUBEDECK_PUBLIC_URL` | Web | none, required | The URL people open, e.g. `https://kubedeck.example.com`. Its hostname is the only one accepted; requests for other hostnames are refused |
| `KUBEDECK_PUBLIC_HOSTS` | Web | none | Comma list of more hostnames to accept, besides the one in `KUBEDECK_PUBLIC_URL` |
| `KUBEDECK_ALLOWED_HOSTS` | Both | none | Comma list of extra hostnames to accept. On the desktop, besides `localhost`, `127.0.0.1` and `[::1]` (e.g. a dev tunnel). In web mode, used for the host list when `KUBEDECK_PUBLIC_HOSTS` is not set, and always accepted |
| `KUBEDECK_PROXY_HOPS` | Web | `0` | How many proxies in front of KubeDeck you trust to set `X-Forwarded-For` (e.g. `1` behind an ingress). The sign-in rate limit and the audit log then see each person's address |
| `KUBEDECK_DEBUG` | Both | off | `1` logs every API request with its status and time, prints internal errors, and logs MCP clients that do not close cleanly |

## Sign-in and accounts

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBEDECK_AUTH_SECRET` | Web (required); Desktop (optional) | none | At least 32 random characters that sign sessions (`openssl rand -base64 32`). Also the source of the keys that encrypt plugin secrets and the kubeconfigs uploaded for clusters and groups. Changing it signs everyone out and makes stored secrets unreadable. On the desktop, if set, it replaces `~/.kubedeck/plugins.key` as the encryption key source |
| `KUBEDECK_ADMIN_EMAIL` | Web | none | The first admin's email. Created at start if no account has that email; an existing account is never changed |
| `KUBEDECK_ADMIN_PASSWORD` | Web | none | The first admin's password, at least 12 characters |
| `KUBEDECK_ADMIN_NAME` | Web | the part of the email before `@` | The first admin's display name |
| `KUBEDECK_ALLOWED_GROUPS` | Web | none (everyone) | Comma list of KubeDeck groups. A person must be in one of them to use KubeDeck at all |

KubeDeck refuses to start in web mode without `KUBEDECK_PUBLIC_URL` or with a `KUBEDECK_AUTH_SECRET` shorter than 32 characters. The message says what to set.

## Database

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBEDECK_DATABASE_URL` | Both | `~/.kubedeck/kubedeck.db` (SQLite) | `sqlite:<path>` for a SQLite file, or `postgres://…` / `postgresql://…` for Postgres. Anything else stops the server with an error. In a container, set it: the default path is not writable on a read-only root filesystem |

See [Database](/web/database).

## Cluster access

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBECONFIG` | Desktop | kubectl's default | Used when none of the kubeconfig files in Settings → Clusters exists, and scanned for files to offer there. Missing files and directories in it are dropped. Web mode ignores it: at start it points `KUBECONFIG` at an empty file |
| `KUBERNETES_SERVICE_HOST`, `KUBERNETES_SERVICE_PORT` | Web | set by Kubernetes; port `443` | When these are set and the pod's service account token is mounted, an admin can add the cluster KubeDeck runs in as **This cluster** in Settings → Clusters, using the pod's service account |

In web mode, no variable adds a cluster or decides who reaches it. Admins add clusters in [Settings → Clusters](/web/clusters) and give access in [Settings → Groups](/web/groups).

### Retired

These are ignored. If one is set, KubeDeck logs `<name> is no longer used: clusters come from Settings → Clusters and access from Settings → Groups.` at start.

| Variable | Was |
| --- | --- |
| `KUBEDECK_ACCESS` | `shared` made everyone act as KubeDeck's own credentials |
| `KUBEDECK_IMPERSONATE_PREFIX` | The prefix of the user name when people acted as themselves (`kubedeck:<email>`) |
| `KUBEDECK_IMPERSONATE_GROUP_PREFIX` | The prefix of group names when people acted as themselves (`kubedeck:<group>`) |

## Feature switches

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBEDECK_READ_ONLY` | Web | `false` | `true` refuses every change to a cluster, from the UI, the palette and the assistant |
| `KUBEDECK_AI` | Web | `on` | `off` turns the assistant and every AI feature off |
| `KUBEDECK_POD_FILES` | Web | `on` | `off` turns pod file browsing off |

Port-forward is always off in web mode; there is no variable for it.

## AI provider

Each variable that is set pins its field under Settings → AI assistant; the rest stay editable. See [AI providers](/integrations/ai-providers).

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBEDECK_AI_PROVIDER` | Both | `openai` | `openai`, `anthropic`, `ollama` or `custom` (OpenAI-compatible) |
| `KUBEDECK_AI_API_KEY` | Both | none | The provider's key. Not needed for `ollama`, optional for `custom` |
| `KUBEDECK_AI_MODEL` | Both | the provider's default | Model id for the assistant |
| `KUBEDECK_AI_FAST_MODEL` | Both | the provider's small model | Model id for short tasks |
| `KUBEDECK_AI_BASE_URL` | Both | the provider's API | The endpoint. Required for `custom` |

## Traces, logs and Grafana

Each variable that is set configures and pins a field of its plugin. A plugin with a URL is on by default. See [Plugins](/integrations/plugins).

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `KUBEDECK_TEMPO_URL` | Both | none | Grafana Tempo's HTTP API. Configures the Tempo traces plugin |
| `KUBEDECK_TEMPO_TOKEN` | Both | none | Bearer token for Tempo |
| `KUBEDECK_TEMPO_TENANT` | Both | none | `X-Scope-OrgID` for a multi-tenant Tempo |
| `KUBEDECK_TEMPO_CLUSTERS` | Both | none | `context=cluster,…`: the `k8s.cluster.name` a context's traces carry. In web mode, the context is the cluster's name in Settings → Clusters |
| `KUBEDECK_GRAFANA_URL` | Both | none | Grafana's URL, for **Open in Grafana** on a trace |
| `KUBEDECK_GRAFANA_TEMPO_DATASOURCE` | Both | none | The Tempo data source uid in Grafana, for the same link |
| `KUBEDECK_LOKI_URL` | Both | none | Grafana Loki's HTTP API. Configures the Loki logs plugin |
| `KUBEDECK_LOKI_TOKEN` | Both | none | Bearer token for Loki |
| `KUBEDECK_LOKI_TENANT` | Both | none | `X-Scope-OrgID` for a multi-tenant Loki |
| `KUBEDECK_GRAFANA_MCP_URL` | Both | none | The Grafana MCP server's Streamable HTTP endpoint (`…/mcp`). Configures the built-in Grafana MCP server |
| `KUBEDECK_GRAFANA_MCP_TOKEN` | Both | none | Bearer token for the Grafana MCP server |

Details: [Grafana Tempo](/integrations/tempo), [Grafana Loki](/integrations/loki), [MCP servers](/integrations/mcp-servers).

## Desktop shell

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `SHELL` | Desktop | `/bin/zsh` | The packaged app on macOS and Linux asks this login shell for your `PATH`, so it finds `kubectl` |
| `PATH` | Desktop | from the shell | Where `kubectl` is found. If the shell cannot be asked, KubeDeck puts `/opt/homebrew/bin`, `/opt/homebrew/sbin`, `/usr/local/bin`, `/usr/local/sbin`, `~/.local/bin` and `~/bin` in front of it |
| `USER`, `USERNAME` | Desktop | `local` | Only when the operating system cannot give the user name: the name of the desktop's one user, shown in the audit log |

## Build and development

| Variable | Mode | Default | Meaning |
| --- | --- | --- | --- |
| `NODE_ENV` | Both | set by the npm scripts | `production` serves the built client from `dist/`; anything else serves it through the Vite dev server. `npm run dev` sets `development`; the production bundle is built with `production` |
| `KUBEDECK_BUNDLE_ALL` | Build | unset | `1` makes `npm run build` bundle every runtime dependency into `dist/index.cjs`, so the image needs no `node_modules`. The Dockerfile sets it |

The Dockerfile also sets `KUBECACHEDIR=/tmp/kube-cache`. That one is read by `kubectl`, not by KubeDeck: it moves kubectl's discovery cache to a writable folder on a read-only root filesystem.

## Related

- [Configuration](/web/configuration)
- [Deploy on Kubernetes](/web/deploy-kubernetes)
- [Run with Docker](/web/docker)
