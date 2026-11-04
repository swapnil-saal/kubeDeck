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

| Variable | Meaning |
|---|---|
| `KUBEDECK_MODE=web` | turn web mode on |
| `KUBEDECK_PUBLIC_URL` | the URL users open, e.g. `https://kubedeck.example.com`. Requests for any other hostname are refused |
| `KUBEDECK_PROXY_SECRET` | ≥16 chars; the proxy must send it as `X-KubeDeck-Proxy-Secret` |
| `KUBEDECK_TRUST_PROXY_NETWORK=1` | alternative to the secret when only the proxy can reach the server (e.g. sidecar, KubeDeck on `127.0.0.1`) |
| `KUBEDECK_ALLOWED_GROUPS` | comma list; the user must be in one (groups come from `X-Forwarded-Groups`) |
| `KUBEDECK_READ_ONLY` | `false` (default) or `true`: refuse every change, from the UI, the palette and the assistant |
| `KUBEDECK_AI` | `on` (default) or `off` |
| `KUBEDECK_POD_FILES` | `on` (default) or `off` |
| `KUBEDECK_AI_PROVIDER` | `openai`, `anthropic`, `ollama` or `custom` (OpenAI-compatible) |
| `KUBEDECK_AI_API_KEY` | the provider's key (not needed for `ollama`, optional for `custom`) |
| `KUBEDECK_AI_MODEL` / `KUBEDECK_AI_FAST_MODEL` | model ids; empty uses the provider's defaults |
| `KUBEDECK_AI_BASE_URL` | the endpoint (required for `custom`) |
| `HOST` | bind address (default `0.0.0.0` in web mode) |
| `KUBECONFIG` | optional; with no kubeconfig inside a pod, KubeDeck builds one context, `in-cluster`, from the pod's service account |

KubeDeck **refuses to start** in web mode unless it has a proxy secret or network-trust flag, a public URL, and (if a secret is set) one of ≥16 characters.

## Deploy

Full runbook with every command: **[DEPLOYMENT.md](DEPLOYMENT.md)**. In short:

1. Build the image: `docker build -t <registry>/kubedeck:<version> .` (the `Dockerfile` has no `HEALTHCHECK`; probes live in the pod spec).
2. In Keycloak create an OIDC client for `https://<your-host>/oauth2/callback` and add a `groups` claim mapper if you want group limits.
3. Edit `deploy/kubernetes/kubedeck.yaml` (every `CHANGE_ME` and `kubedeck.example.com`) and apply it.

The manifest runs oauth2-proxy as a sidecar and binds KubeDeck to `127.0.0.1`, so nothing except the sidecar can reach it. The service account gets `kubedeck-reader` (reads, **no secrets**) and `kubedeck-operator` (changes to workloads and `pods/exec` for pod files). For a look-only KubeDeck, delete `kubedeck-operator` and set `KUBEDECK_READ_ONLY=true`.

### Who sees what

With one service account, **every signed-in user sees what that account sees**. The proxy decides who may *enter*; Kubernetes RBAC for the service account decides what they can *read*. The same goes for changes and the assistant: what the account may do, every signed-in user may do. To limit people differently, run several KubeDeck instances with different service accounts, or ask for per-user impersonation (not built yet).

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
