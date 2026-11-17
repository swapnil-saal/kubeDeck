---
title: "Configuration"
description: "Every environment variable KubeDeck's web mode reads, with its default and what it does."
---

# Configuration

Web mode's server settings come only from environment variables. Clusters and who may reach them are not settings: admins manage them in [Settings → Clusters](/web/clusters) and [Settings → Groups](/web/groups). This page lists every variable web mode reads, grouped by what it controls.

For the full list across both modes, see [Environment variables](/reference/environment-variables).

## Values

- Switches that turn something **on** (`KUBEDECK_READ_ONLY`) accept `1`, `true`, `yes` or `on`, in any case.
- Switches that turn something **off** (`KUBEDECK_AI`, `KUBEDECK_POD_FILES`) accept `0`, `false`, `no` or `off`.
- Lists are comma-separated. Spaces around items are ignored.

## Required

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_MODE` | unset (desktop) | `web` turns web mode on. The Docker image sets it. |
| `KUBEDECK_PUBLIC_URL` | none | The address people open, such as `https://kubedeck.example.com`. Must start with `http://` or `https://`. Requests for other hostnames are refused. Sign-in trusts only this origin. With `https://`, session cookies are marked secure. |
| `KUBEDECK_AUTH_SECRET` | none | At least 32 characters. Signs sessions, and derives the keys that encrypt clusters' and groups' uploaded kubeconfigs and plugin secrets. Keep it stable: changing it signs everyone out and makes those secrets unreadable. |

## First admin

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_ADMIN_EMAIL` | none | Creates this admin on start if no account has that email. An existing account is never changed. |
| `KUBEDECK_ADMIN_PASSWORD` | none | The first admin's password. At least 12 characters. Needed only until the account exists. |
| `KUBEDECK_ADMIN_NAME` | the part of the email before `@` | The first admin's display name. |

## Access

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_ALLOWED_GROUPS` | unset (anyone with an account) | Group ids. A person must be in one of them to use KubeDeck at all. This applies to admins too. |
| `KUBEDECK_READ_ONLY` | `false` | `true` refuses every change to a cluster, from the UI, the palette and the assistant. |

Which clusters a person reaches, and as which service account, is set in **Settings → Groups**, not here.

### Retired

These are ignored. If one is set, KubeDeck logs `<name> is no longer used: clusters come from Settings → Clusters and access from Settings → Groups.` at start. Remove them.

| Variable | Was |
|---|---|
| `KUBEDECK_ACCESS` | `shared` made everyone act as KubeDeck's own credentials. |
| `KUBEDECK_IMPERSONATE_PREFIX` | The prefix of the user name when people acted as themselves (`kubedeck:<email>`). |
| `KUBEDECK_IMPERSONATE_GROUP_PREFIX` | The prefix of group names when people acted as themselves (`kubedeck:<group>`). |

## Features

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_AI` | `on` | `off` turns off Ask Deck and every AI feature. |
| `KUBEDECK_POD_FILES` | `on` | `off` turns off browsing files inside containers. |

Group permissions can turn these off for some people. See [Permissions](/web/permissions).

## Network

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5000` | The port KubeDeck listens on. |
| `HOST` | `0.0.0.0` in web mode | The address it binds to. The desktop binds `127.0.0.1`. |
| `KUBEDECK_PROXY_HOPS` | `0` | How many proxies in front of KubeDeck you trust to set `X-Forwarded-For`. Set `1` behind one ingress, so the sign-in rate limit and the audit log see each person's address. |
| `KUBEDECK_PUBLIC_HOSTS` | unset | Extra hostnames whose requests are accepted, besides the one in `KUBEDECK_PUBLIC_URL`. |
| `KUBEDECK_ALLOWED_HOSTS` | unset | Extra hostnames to accept, like `KUBEDECK_PUBLIC_HOSTS`. Either one works. |

## Database

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_DATABASE_URL` | `sqlite:` at `~/.kubedeck/kubedeck.db` | `sqlite:/data/kubedeck.db` for a file, or `postgres://user:pass@host:5432/kubedeck`. Set it in a container. See [Database](/web/database). |

## Clusters

| Variable | Default | Meaning |
|---|---|---|
| `KUBECONFIG` | ignored | Web mode never reads a kubeconfig from the server's disk. At start it points `KUBECONFIG` at an empty file. Add clusters in [Settings → Clusters](/web/clusters). |
| `KUBECACHEDIR` | `/tmp/kube-cache` in the image | kubectl's discovery cache. The image points it at `/tmp` because the root filesystem may be read-only. |

No variable adds a cluster. When KubeDeck runs in a pod, an admin can add the cluster it runs in as **This cluster**, with the pod's own service account.

## AI provider

Each variable that is set pins that field. Admins set the rest in **Settings → AI assistant**, where pinned fields show as read-only. See [AI providers](/integrations/ai-providers).

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_AI_PROVIDER` | unset | `openai`, `anthropic`, `ollama` or `custom` (OpenAI-compatible). |
| `KUBEDECK_AI_API_KEY` | unset | The provider's key. |
| `KUBEDECK_AI_MODEL` | provider default | The main model id. |
| `KUBEDECK_AI_FAST_MODEL` | the provider's small model | The model for short tasks. |
| `KUBEDECK_AI_BASE_URL` | unset | The endpoint, for Ollama and OpenAI-compatible gateways. |

## Traces, logs and Grafana

Each one configures and switches on a plugin. A variable that is set wins over **Settings → Plugins**, where it shows as read-only.

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_TEMPO_URL` | unset | Grafana Tempo's HTTP API. See [Grafana Tempo](/integrations/tempo). |
| `KUBEDECK_TEMPO_TOKEN` | unset | Bearer token for Tempo. |
| `KUBEDECK_TEMPO_TENANT` | unset | `X-Scope-OrgID` for Tempo. |
| `KUBEDECK_TEMPO_CLUSTERS` | unset | `context=cluster,…`: the cluster name a context's traces carry. In web mode, the context is the cluster's name in **Settings → Clusters**. |
| `KUBEDECK_GRAFANA_URL` | unset | Grafana's address, for opening a trace in Grafana. |
| `KUBEDECK_GRAFANA_TEMPO_DATASOURCE` | unset | The Tempo data source uid in Grafana. |
| `KUBEDECK_LOKI_URL` | unset | Grafana Loki's HTTP API. See [Grafana Loki](/integrations/loki). |
| `KUBEDECK_LOKI_TOKEN` | unset | Bearer token for Loki. |
| `KUBEDECK_LOKI_TENANT` | unset | `X-Scope-OrgID` for Loki. |
| `KUBEDECK_GRAFANA_MCP_URL` | unset | The Grafana MCP server's endpoint. See [MCP servers](/integrations/mcp-servers). |
| `KUBEDECK_GRAFANA_MCP_TOKEN` | unset | Its token. |

## Diagnostics

| Variable | Default | Meaning |
|---|---|---|
| `KUBEDECK_DEBUG` | unset | `1` logs every API request with its status and duration, and full server errors. |
| `NODE_ENV` | `production` in the image | `production` serves the built client. Leave it as the image sets it. |

## What stops the server from starting

KubeDeck refuses to start in web mode with a half-done setup. It prints each problem and exits:

| Message | Fix |
|---|---|
| ``Web mode needs KUBEDECK_AUTH_SECRET of at least 32 characters (e.g. `openssl rand -base64 32`).`` | Set a longer secret. |
| `Web mode needs KUBEDECK_PUBLIC_URL, the address people open (e.g. https://kubedeck.example.com).` | Set the URL, with its scheme. |
| `KUBEDECK_ADMIN_PASSWORD must be at least 12 characters.` | Use a longer password. |
| `Web mode cannot start without its database: …` | See [Database](/web/database). |
