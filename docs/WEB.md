# KubeDeck web mode

Run KubeDeck as a shared web service for a team, next to (or instead of) the desktop app. KubeDeck signs people in itself: an admin creates accounts and puts people in groups, and every action runs in the cluster **as that person**, so Kubernetes RBAC decides what each of them can see and change.

```
browser ──HTTPS──▶ ingress ──▶ KubeDeck ──kubectl --as=kubedeck:<email> --as-group=kubedeck:<group>──▶ Kubernetes API
                   sign-in page │                                                                     RBAC decides
                                └──▶ database (SQLite file, or Postgres): accounts, sessions, audit log
```

## What is different from the desktop app

| | Desktop | Web mode |
|---|---|---|
| Who is allowed | whoever is at the machine | people with an account an admin created (optionally limited to groups) |
| Cluster identity | your kubeconfig | per cluster, the service account the person's group uses there (Settings → Groups: impersonated, or from an uploaded kubeconfig), else the person through impersonation: `kubedeck:<email>` in groups `kubedeck:<group>` |
| Writes (scale, restart, edit, delete) | allowed | allowed where the person's RBAC allows (`KUBEDECK_READ_ONLY=true` turns them off for everyone) |
| Browse pod files | yes | yes, where the person may `exec` (`KUBEDECK_POD_FILES=off` turns it off). Only fixed read-only scripts run in the pod |
| AI (Ask Deck, diagnose, explain, summaries, command translation) | provider set in Settings → AI assistant | provider set by an admin in Settings → AI assistant (stored encrypted), or pinned by the server's `KUBEDECK_AI_*` env, which wins (`KUBEDECK_AI=off` turns AI off). The assistant acts as the signed-in person. Cluster data it reads goes to that provider |
| Port-forward | yes | no: the port would open inside the server, not on the user's machine |
| Settings | edited in the app | configuration comes from the environment; admins manage **Users**, **Groups** and read the **Audit log** |
| Projects | kept in KubeDeck's database on this computer | kept in KubeDeck's database and shared: everyone sees every project, its creator or an admin changes it |
| kubectl palette and assistant | any verb | no `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach`, `debug`, and no `--token/--server/--kubeconfig/--as/--user/--cluster` flags, so nobody steps outside their own identity. The assistant's pipelines run without a shell. When read-only, both only read |
| Audit | every change in **Settings → Audit log**, kept in `~/.kubedeck/kubedeck.db` under your computer's user name | every change (UI, palette, assistant) in **Settings → Audit log** and as a JSON line on stdout, with the person and their groups |

What a person sees follows their RBAC: kinds they may not list are left out of the sidebar, and actions they may not take are not shown.

## Settings (environment variables)

| Variable | Meaning |
|---|---|
| `KUBEDECK_MODE=web` | turn web mode on |
| `KUBEDECK_PUBLIC_URL` | the URL people open, e.g. `https://kubedeck.example.com`. Requests for any other hostname are refused |
| `KUBEDECK_AUTH_SECRET` | **required**: ≥32 random characters that sign sessions (`openssl rand -base64 32`). Keep it stable: changing it signs everyone out |
| `KUBEDECK_ADMIN_EMAIL` / `KUBEDECK_ADMIN_PASSWORD` / `KUBEDECK_ADMIN_NAME` | the first admin, created at start if that email does not exist yet (an existing account is never changed). Password ≥12 characters |
| `KUBEDECK_DATABASE_URL` | **set it in a container**: `sqlite:/data/kubedeck.db` (one replica, on a volume; the default `~/.kubedeck/kubedeck.db` is not writable on a read-only root filesystem) or `postgres://user:pass@host:5432/kubedeck` (several replicas) |
| `KUBEDECK_PROXY_HOPS` | how many proxies in front of KubeDeck you trust to set `X-Forwarded-For` (e.g. `1` behind an ingress), so the sign-in rate limit and the audit log see each person's address |
| `KUBEDECK_ALLOWED_GROUPS` | comma list; a person must be in one of these KubeDeck groups to use KubeDeck at all |
| `KUBEDECK_IMPERSONATE_PREFIX` / `KUBEDECK_IMPERSONATE_GROUP_PREFIX` | prepended to user / group names sent to Kubernetes (default `kubedeck:`; the group prefix cannot be empty) |
| `KUBEDECK_ACCESS=shared` | turns impersonation off: everyone acts as KubeDeck's own service account, whatever their groups. Avoid it |
| `KUBEDECK_READ_ONLY` | `false` (default) or `true`: refuse every change, from the UI, the palette and the assistant |
| `KUBEDECK_AI` | `on` (default) or `off` |
| `KUBEDECK_POD_FILES` | `on` (default) or `off` |
| `KUBEDECK_AI_PROVIDER` | `openai`, `anthropic`, `ollama` or `custom` (OpenAI-compatible). Each `KUBEDECK_AI_*` variable that is set pins that field; admins set the rest in Settings → AI assistant |
| `KUBEDECK_AI_API_KEY` | the provider's key (not needed for `ollama`, optional for `custom`) |
| `KUBEDECK_AI_MODEL` / `KUBEDECK_AI_FAST_MODEL` | model ids; empty uses the provider's defaults |
| `KUBEDECK_AI_BASE_URL` | the endpoint (required for `custom`) |
| `KUBEDECK_TEMPO_URL` | Grafana Tempo's HTTP API, e.g. `https://tempo.example.com`: configures and switches on the **Tempo traces** plugin (workload **Traces** tab, Overview → **Traces**, the assistant's trace tools). Settings → Plugins can do the same; a variable that is set wins and shows read-only there |
| `KUBEDECK_TEMPO_TOKEN` / `KUBEDECK_TEMPO_TENANT` | optional bearer token / `X-Scope-OrgID` for Tempo (the Tempo traces plugin's Token and Tenant) |
| `KUBEDECK_LOKI_URL` / `KUBEDECK_LOKI_TOKEN` / `KUBEDECK_LOKI_TENANT` | optional: Grafana Loki's HTTP API (+ bearer token / `X-Scope-OrgID`): configures and switches on the **Loki logs** plugin: the pod's log lines next to a traced request, and log history (pods that are gone, up to 7 days) for the assistant. Streams are matched by `cluster` and `namespace` labels, pods by the `pod` label or metadata. Settings → Plugins can do the same; the environment wins |
| `KUBEDECK_TEMPO_CLUSTERS` | optional `context=cluster,…`: the `k8s.cluster.name` a context's traces carry, where KubeDeck cannot tell (in-cluster the context is `in-cluster`, so set `in-cluster=<your cluster name>`); the Tempo traces plugin's Clusters |
| `KUBEDECK_GRAFANA_URL` / `KUBEDECK_GRAFANA_TEMPO_DATASOURCE` | optional: Grafana and the Tempo data source uid, for "Open in Grafana" on a trace (part of the Tempo traces plugin) |
| `KUBEDECK_GRAFANA_MCP_URL` / `KUBEDECK_GRAFANA_MCP_TOKEN` | optional: the [Grafana MCP server](https://github.com/grafana/mcp-grafana)'s streamable-HTTP endpoint (`…/mcp`) and its token; the assistant then reads Prometheus, Loki, dashboards and alerts through it |
| `HOST` | bind address (default `0.0.0.0` in web mode) |
| `KUBECONFIG` | optional; with no kubeconfig inside a pod, KubeDeck builds one context, `in-cluster`, from the pod's service account |

KubeDeck **refuses to start** in web mode without a public URL or a ≥32-character `KUBEDECK_AUTH_SECRET`; the message says what to set.

## Accounts, groups and RBAC

KubeDeck shows a sign-in page. There is no self sign-up: an admin adds people under **Settings → Users**, sets their password (or generates one), and puts them in groups.

- **Groups are defined under Settings → Groups** (e.g. *Developers*, *Quality team*), and an account can only be in groups defined there. Groups accounts already had are defined automatically on start. For each cluster a group uses one service account:
  - **Picked from the cluster, impersonated** (`--as=system:serviceaccount:<ns>:<name>`). The form lists the namespace's service accounts as KubeDeck sees them and says whether KubeDeck may impersonate them; its credentials for that cluster need `impersonate` on that service account.
  - **From an uploaded kubeconfig**, where KubeDeck may not impersonate. Only a token or an inline client certificate is accepted (exec plugins, auth providers and file paths are refused). It is checked with `kubectl auth whoami` on save, stored encrypted with a key derived from `KUBEDECK_AUTH_SECRET`, and never sent back to the browser. Changing that secret makes stored kubeconfigs unreadable: upload them again.

  When several of someone's groups cover the same cluster, the group higher in the list wins (reorder with the arrows). The palette and the assistant refuse `--user` and `--cluster`, so nobody can borrow another context's credentials.
- **A KubeDeck admin uses KubeDeck's own credentials** on a cluster none of their groups covers, so a new install works as soon as its first admin (`KUBEDECK_ADMIN_EMAIL`) signs in. Make someone an admin only if they may do what KubeDeck's kubeconfig (or service account) can.
- **For everyone else, on a cluster none of their groups covers, KubeDeck acts as the person.** The kubectl call runs as `kubedeck:<email>` with each of their groups as `kubedeck:<group>`, so you can bind those groups to roles instead:

  ```sh
  kubectl create rolebinding shop-editors --clusterrole=edit --group=kubedeck:shop-editors -n shop
  kubectl create clusterrolebinding kubedeck-viewers --clusterrole=view --group=kubedeck:viewers
  ```

  Someone in no bound group sees nothing. Group changes apply on their next request. The `kubedeck:` prefix keeps a KubeDeck group from ever being a built-in one such as `system:masters`.
- **For acting as the person, KubeDeck's service account needs only `impersonate`** on `users` and `groups` (the `kubedeck-impersonator` role in the manifest; add `serviceaccounts` for groups that act as a service account). A kubectl call made outside a person's request runs as `system:anonymous`, never as the service account.
- **The KubeDeck role:** an admin manages people, groups, plugins and the audit log, and (see above) has KubeDeck's own access where no group of theirs applies. An admin cannot remove their own admin role, block or delete themselves.
- Sessions last 12 hours. Sign-in is rate limited per address (10 tries a minute). Blocking an account signs it out at once; so does **Sign out everywhere**.
- Back up the database: it holds the accounts (passwords hashed with scrypt), groups, projects, plugin settings and the audit log.

### Traces and Grafana

Traces come from Tempo, found by the OpenTelemetry resource attributes the OTel operator or collector puts on every span (`k8s.cluster.name`, `k8s.namespace.name`, `k8s.deployment.name`, `k8s.pod.name`, `service.name`). A kube context is matched to its Tempo cluster by `KUBEDECK_TEMPO_CLUSTERS`, then by name, then by the one cluster whose traces carry the namespace on screen.

- **What you get:** on a workload's Traces tab, its endpoints with requests, error % and p95 (click p95 for requests that slow), a rollout check on Deployments (new ReplicaSet vs the old ones), and each trace in a side panel with the pod's log lines from Loki at that moment. Overview → Traces does the same per service for the namespace. Tempo answers metrics for at most 3h by default; longer windows are measured over that.
- **Who sees which traces:** a namespace's traces (and its Loki logs) are shown only to someone who may `list pods` there. One trace that crosses namespaces loses the spans from namespaces the person cannot read.
- **Grafana MCP:** the assistant gets only Grafana's read tools (searches, queries, lists, `generate_deeplink`); anything that creates, updates or deletes, raw SQL and the generic API tool are never offered. Run the MCP server with `--disable-write` anyway. Grafana data is not filtered per person: everyone reads what the MCP server's Grafana token can read.

## Deploy

Full runbook with every command: **[DEPLOYMENT.md](DEPLOYMENT.md)**. In short: create a Secret with the session secret and the first admin, apply `deploy/kubernetes/kubedeck.yaml` (one replica, SQLite on a 1 GB volume, a service account that may only impersonate), bind your groups to roles, sign in and add people.

## Limits to know

- Alerts and the log explorer work, but alerts only run while a browser tab is open. With AI off, issues on the home screen open the pod or deployment instead of asking the assistant.
- Chat history stays in each person's browser; the server keeps none.
- With SQLite, run exactly one replica (the manifest uses the `Recreate` strategy). For more, use Postgres.

## Try it locally

```sh
KUBEDECK_MODE=web KUBEDECK_PUBLIC_URL=http://localhost:5051 \
KUBEDECK_AUTH_SECRET="$(openssl rand -base64 32)" \
KUBEDECK_ADMIN_EMAIL=you@example.com KUBEDECK_ADMIN_PASSWORD='choose-a-long-one' \
PORT=5051 npm run dev
```

Open http://localhost:5051 and sign in. Your own kubeconfig must be allowed to impersonate (a local kind or Docker Desktop cluster is), and your groups need bindings; `deploy/demo/kubedeck-demo.yaml` creates demo workloads and binds the groups `viewers`, `admins`, `shop-viewers`, `shop-editors` and `ops-editors`.
