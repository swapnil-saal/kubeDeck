# KubeDeck web mode

Run KubeDeck as a shared web service behind your login (Keycloak via oauth2-proxy, or any proxy that sets identity headers) instead of as a desktop app.

```
browser ──HTTPS──▶ ingress ──▶ oauth2-proxy ──(127.0.0.1)──▶ KubeDeck ──▶ Kubernetes API
                     Keycloak login ▲          X-Forwarded-User/Email/Groups     (service account)
```

KubeDeck never sees passwords. It trusts the identity headers only when the request provably came through the proxy.

## What is different from the desktop app

| | Desktop | Web mode |
|---|---|---|
| Who is allowed | whoever is at the machine | users the proxy signed in (optionally limited to groups) |
| Cluster identity | your kubeconfig | the server's: a service account (in a pod) or the server's `KUBECONFIG` |
| Writes (scale, restart, edit, delete) | allowed | allowed (`KUBEDECK_READ_ONLY=true` turns them off) |
| Browse pod files | yes | yes (`KUBEDECK_POD_FILES=off` turns it off). Only fixed read-only scripts run in the pod; the service account needs `pods/exec` |
| AI (Ask Deck, diagnose, explain, summaries, command translation) | provider set in Settings | yes, provider set by the server's `KUBEDECK_AI_*` env (`KUBEDECK_AI=off` turns it off). Cluster data the assistant reads goes to that provider |
| Port-forward | yes | no: the port would open inside the server, not on the user's machine |
| Settings | edited in the app | none: configuration comes from the environment |
| kubectl palette and assistant | any verb | no `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach`, `debug`, and no `--token/--server/--kubeconfig/--as` flags, so nobody steps outside the server's identity. The assistant's pipelines run without a shell. When read-only, both only read |
| Audit | – | one JSON line on stdout per write (including palette and assistant requests), with the user; assistant approvals and changes are logged with the user too |

## Settings (environment variables)

What a user sees follows the cluster identity's RBAC: kinds it may not list are left out of the sidebar, and actions it may not take (edit, scale, restart, delete, exec…) are not shown at all.


| Variable | Meaning |
|---|---|
| `KUBEDECK_MODE=web` | turn web mode on |
| `KUBEDECK_PUBLIC_URL` | the URL users open, e.g. `https://kubedeck.example.com`. Requests for any other hostname are refused |
| `KUBEDECK_PROXY_SECRET` | ≥16 chars; the proxy must send it as `X-KubeDeck-Proxy-Secret` |
| `KUBEDECK_TRUST_PROXY_NETWORK=1` | alternative to the secret when only the proxy can reach the server (e.g. sidecar, KubeDeck on `127.0.0.1`) |
| `KUBEDECK_ALLOWED_GROUPS` | comma list; the user must be in one (groups come from `X-Forwarded-Groups`) |
| `KUBEDECK_ACCESS=impersonate` | **per-user permissions**: act as each signed-in user (`kubectl --as`), so their own RBAC applies. See below |
| `KUBEDECK_IMPERSONATE_USER` | `email` (default) or `name`: which proxy header becomes the Kubernetes user name |
| `KUBEDECK_IMPERSONATE_PREFIX` / `KUBEDECK_IMPERSONATE_GROUP_PREFIX` | prepended to user / group names, to match the API server's OIDC prefixes (e.g. `oidc:`) |
| `KUBEDECK_AUTH=none` | **no login at all**, for private test clusters: no proxy needed, everyone who reaches the URL is `anonymous`. See below |
| `KUBEDECK_READ_ONLY` | `false` (default) or `true`: refuse every change, from the UI, the palette and the assistant |
| `KUBEDECK_AI` | `on` (default) or `off` |
| `KUBEDECK_POD_FILES` | `on` (default) or `off` |
| `KUBEDECK_AI_PROVIDER` | `openai`, `anthropic`, `ollama` or `custom` (OpenAI-compatible) |
| `KUBEDECK_AI_API_KEY` | the provider's key (not needed for `ollama`, optional for `custom`) |
| `KUBEDECK_AI_MODEL` / `KUBEDECK_AI_FAST_MODEL` | model ids; empty uses the provider's defaults |
| `KUBEDECK_AI_BASE_URL` | the endpoint (required for `custom`) |
| `KUBEDECK_TEMPO_URL` | Grafana Tempo's HTTP API, e.g. `https://tempo.example.com`: turns on traces (workload **Traces** tab, Overview → **Traces**, the assistant's trace tools) |
| `KUBEDECK_TEMPO_TOKEN` / `KUBEDECK_TEMPO_TENANT` | optional bearer token / `X-Scope-OrgID` for Tempo |
| `KUBEDECK_LOKI_URL` / `KUBEDECK_LOKI_TOKEN` / `KUBEDECK_LOKI_TENANT` | optional: Grafana Loki's HTTP API (+ bearer token / `X-Scope-OrgID`): the pod's log lines next to a traced request, and log history (pods that are gone, up to 7 days) for the assistant. Streams are matched by `cluster` and `namespace` labels, pods by the `pod` label or metadata |
| `KUBEDECK_TEMPO_CLUSTERS` | optional `context=cluster,…`: the `k8s.cluster.name` a context's traces carry, where KubeDeck cannot tell (in-cluster the context is `in-cluster`, so set `in-cluster=<your cluster name>`) |
| `KUBEDECK_GRAFANA_URL` / `KUBEDECK_GRAFANA_TEMPO_DATASOURCE` | optional: Grafana and the Tempo data source uid, for "Open in Grafana" on a trace |
| `KUBEDECK_GRAFANA_MCP_URL` / `KUBEDECK_GRAFANA_MCP_TOKEN` | optional: the [Grafana MCP server](https://github.com/grafana/mcp-grafana)'s streamable-HTTP endpoint (`…/mcp`) and its token; the assistant then reads Prometheus, Loki, dashboards and alerts through it |
| `HOST` | bind address (default `0.0.0.0` in web mode) |
| `KUBECONFIG` | optional; with no kubeconfig inside a pod, KubeDeck builds one context, `in-cluster`, from the pod's service account |

KubeDeck **refuses to start** in web mode unless it has a proxy secret or network-trust flag (or `KUBEDECK_AUTH=none`), a public URL, and (if a secret is set) one of ≥16 characters.

### Per-user permissions (`KUBEDECK_ACCESS=impersonate`)

By default every signed-in user acts with KubeDeck's service account. With `KUBEDECK_ACCESS=impersonate`, KubeDeck adds `--as=<user> --as-group=<group>…` (plus `system:authenticated`) to every kubectl call it makes for a request, using the user and groups the login proxy reported. The API server then applies that person's RBAC to everything: lists, details, changes, pod files, the map and the assistant's commands. Buttons the person may not use are disabled with the reason.

- Bind roles to your users and groups as the API server knows them. If the API server trusts Keycloak with `--oidc-username-prefix=oidc:`, set `KUBEDECK_IMPERSONATE_PREFIX=oidc:` (same for groups) so the names match.
- Give KubeDeck's service account only `impersonate` on `users` and `groups` (the `kubedeck-impersonator` role, commented in the manifest) and remove `kubedeck-reader` / `kubedeck-operator`.
- The API server does not need to trust Keycloak: KubeDeck vouches for the identity, so keep the login proxy in front (it cannot be combined with `KUBEDECK_AUTH=none`).
- A kubectl call made outside a user's request runs as `system:anonymous`, never as the service account.

### No sign-in (`KUBEDECK_AUTH=none`)

For a private test cluster where you do not want a login yet: run KubeDeck alone (no oauth2-proxy), with `HOST=0.0.0.0`, `KUBEDECK_AUTH=none` and `KUBEDECK_PUBLIC_URL` set to the address people open (an IP is fine). Every request is the user `anonymous`; identity headers are ignored; the host check still applies; audit lines carry the caller's IP. The header shows a **No sign-in** badge and the server logs a warning at startup.

Anyone who can reach the URL gets the cluster access of KubeDeck's kubeconfig or service account, including changes and pod files unless you turn them off. Prefer `KUBEDECK_READ_ONLY=true`, keep it on a network only your team reaches, and switch to a login proxy before wider use. `KUBEDECK_ALLOWED_GROUPS` cannot be used with it.

### Traces and Grafana

Traces come from Tempo, found by the OpenTelemetry resource attributes the OTel operator or collector puts on every span (`k8s.cluster.name`, `k8s.namespace.name`, `k8s.deployment.name`, `k8s.pod.name`, `service.name`). A kube context is matched to its Tempo cluster by `KUBEDECK_TEMPO_CLUSTERS`, then by name, then by the one cluster whose traces carry the namespace on screen.

- **What you get:** on a workload's Traces tab, its endpoints with requests, error % and p95 (click p95 for requests that slow), a rollout check on Deployments (new ReplicaSet vs the old ones), and each trace in a side panel with the pod's log lines from Loki at that moment. Overview → Traces does the same per service for the namespace. Tempo answers metrics for at most 3h by default; longer windows are measured over that.
- **Who sees which traces:** a namespace's traces (and its Loki logs) are shown only to someone whose identity may `list pods` there (the signed-in user with impersonation, otherwise KubeDeck's service account). One trace that crosses namespaces loses the spans from namespaces the user cannot read.
- **Grafana MCP:** the assistant gets only Grafana's read tools (searches, queries, lists, `generate_deeplink`); anything that creates, updates or deletes, raw SQL and the generic API tool are never offered. Run the MCP server with `--disable-write` anyway. Grafana data is not filtered per user: every user of this KubeDeck reads what the MCP server's Grafana token can read.

## Deploy

Full runbook with every command: **[DEPLOYMENT.md](DEPLOYMENT.md)**. In short:

1. Use `swapnilsaal/kubedeck:<version>-web` (amd64 + arm64), or build your own: `docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/kubedeck:<version>-web --push .` (the `Dockerfile` has no `HEALTHCHECK`; probes live in the pod spec).
2. In Keycloak create an OIDC client for `https://<your-host>/oauth2/callback` and add a `groups` claim mapper if you want group limits.
3. Edit `deploy/kubernetes/kubedeck.yaml` (every `CHANGE_ME` and `kubedeck.example.com`) and apply it.

The manifest runs oauth2-proxy as a sidecar and binds KubeDeck to `127.0.0.1`, so nothing except the sidecar can reach it. The service account gets `kubedeck-reader` (reads, **no secrets**) and `kubedeck-operator` (changes to workloads and `pods/exec` for pod files). For a look-only KubeDeck, delete `kubedeck-operator` and set `KUBEDECK_READ_ONLY=true`.

### Who sees what

With one service account, **every signed-in user sees what that account sees** (unless you turn on per-user permissions, above). The proxy decides who may *enter*; Kubernetes RBAC for the service account decides what they can *read*. The same goes for changes and the assistant: what the account may do, every signed-in user may do. To limit people differently, run several KubeDeck instances with different service accounts, or ask for per-user impersonation (not built yet).

## Limits to know

- Alerts and the log explorer work, but alerts only run while a browser tab is open. With AI off, issues on the home screen open the pod or deployment instead of asking the assistant.
- Chat history stays in each user's browser; the server keeps none.
- If you put your own ingress-level oauth2-proxy in front instead of the sidecar, have it send `X-KubeDeck-Proxy-Secret` (ingress-nginx `configuration-snippet`) and set `KUBEDECK_PROXY_SECRET`; do **not** use the network-trust flag unless a NetworkPolicy really restricts access.
- `X-Forwarded-Groups` is trusted exactly as much as the proxy that sets it.

## Try it locally

```
KUBEDECK_MODE=web KUBEDECK_PUBLIC_URL=https://kubedeck.example.com \
KUBEDECK_PROXY_SECRET=0123456789abcdef0123 PORT=5301 npm run dev
curl -H 'Host: kubedeck.example.com' -H 'X-KubeDeck-Proxy-Secret: 0123456789abcdef0123' \
     -H 'X-Forwarded-Email: you@example.com' http://127.0.0.1:5301/api/mode
```
