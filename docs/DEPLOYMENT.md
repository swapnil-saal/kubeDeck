# Deploying KubeDeck (web) to Kubernetes

A step-by-step runbook for running KubeDeck as a shared web service behind your Keycloak login, with the desktop app's features (writes, the AI assistant, pod files) on unless you turn them off. For *why* it works this way, see [WEB.md](WEB.md).

```
browser ──HTTPS──▶ ingress ──▶ oauth2-proxy ──(127.0.0.1)──▶ KubeDeck ──▶ Kubernetes API
                    Keycloak login            adds user / email / groups     (service account)
```

Both containers run in **one pod**. Only oauth2-proxy is reachable from outside; KubeDeck listens on `127.0.0.1`, so nothing but the sidecar can talk to it.

## What you need

| | |
|---|---|
| A Kubernetes cluster | with an ingress controller (the manifest uses `nginx`) and a TLS certificate for your hostname |
| A hostname | e.g. `kubedeck.yourcompany.com`, pointing at the ingress |
| Keycloak admin access | to create one OIDC client |
| `kubectl` access | able to create a namespace, RBAC and a Deployment |
| The image | `swapnilsaal/kubedeck:1.14.0-web` on Docker Hub, or build your own (below) |

## 1. The image

Use the published image as-is, or build and push your own:

```sh
script/docker-build.sh                       # local build for this machine: swapnilsaal/kubedeck:<version>-web
script/docker-build.sh --push                # amd64 + arm64, pushed as one tag (needs docker login)
# your own registry, both architectures:
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/kubedeck:<version>-web --push .
```

The published image covers `linux/amd64` and `linux/arm64`. It is about 312 MB, runs as the non-root user uid 1000 (`node`), contains `kubectl` and `jq`, and contains **no kubeconfig and no secrets** (the AI provider key comes from a Secret you create). If your registry is private, add an `imagePullSecrets` entry to the pod spec.

## 2. Create the Keycloak client

In the Keycloak admin console (realm `master`, or your own realm):

1. **Clients → Create client**: type *OpenID Connect*, client ID `kubedeck`.
2. Turn **Client authentication** *on* (a confidential client) and keep *Standard flow* on.
3. **Valid redirect URIs**: `https://<your-host>/oauth2/callback` (exact). **Web origins**: `https://<your-host>`.
4. Copy the client secret from the **Credentials** tab.
5. *(Only if you want to limit access by group.)* **Client scopes → kubedeck-dedicated → Add mapper → Group Membership**: token claim name `groups`, *Full group path* **off**, add to ID token and access token.

Note down: the client ID, the client secret, and the issuer URL, `https://<keycloak-host>/realms/<realm>` (Keycloak before version 17: `https://<keycloak-host>/auth/realms/<realm>`).

## 3. Create the namespace and secrets

Secrets are created with `kubectl`, never written into the YAML:

```sh
kubectl create namespace kubedeck

kubectl -n kubedeck create secret generic kubedeck-oauth \
  --from-literal=client-id='kubedeck' \
  --from-literal=client-secret='<the Keycloak client secret>' \
  --from-literal=cookie-secret="$(openssl rand -base64 32 | tr -- '+/' '-_')"
```

For the AI assistant, add the provider (skip this and the assistant shows as offline; `KUBEDECK_AI=off` hides it):

```sh
kubectl -n kubedeck create secret generic kubedeck-ai \
  --from-literal=provider='anthropic' \
  --from-literal=api-key='<the provider key>'
# optional keys: model, fast-model, base-url (base-url is required for provider=custom)
```

The manifest also declares the namespace, so the later `kubectl apply` simply adopts it (a harmless warning about a missing annotation is normal).

## 4. Edit the manifest

Open `deploy/kubernetes/kubedeck.yaml` and change:

| Find | Replace with |
|---|---|
| `kubedeck.example.com` (4 places: `KUBEDECK_PUBLIC_URL`, `--redirect-url`, Ingress `tls` and `rules`) | your hostname |
| `--oidc-issuer-url=...` | your Keycloak issuer URL |
| `secretName: CHANGE_ME-tls` | the name of your TLS secret (or remove `tls` and use your cert-manager annotation) |
| `image:` | your image, if not using the published one |
| `--email-domain=*` | your company's email domain, **or** add `--allowed-group=<keycloak group>`; as shipped, anyone Keycloak can sign in may enter |

Optional settings (environment variables on the `kubedeck` container):

| Variable | Effect |
|---|---|
| `KUBEDECK_ALLOWED_GROUPS=platform,sre` | the user must be in one of these Keycloak groups (needs the groups mapper from step 2) |
| `KUBEDECK_READ_ONLY=true` | refuse scale / restart / edit / delete everywhere, including the assistant. Default: allowed, within the service account's RBAC (`kubedeck-operator`) |
| `KUBEDECK_AI=off` | hide the assistant and every AI feature |
| `KUBEDECK_POD_FILES=off` | hide the pod Files tab (and drop `pods/exec` from `kubedeck-operator`) |

### Trying it without Keycloak

For a private test cluster you can skip steps 2 and the `kubedeck-oauth` Secret: remove the oauth2-proxy container, and on the `kubedeck` container set `HOST=0.0.0.0`, `KUBEDECK_AUTH=none` and `KUBEDECK_PUBLIC_URL=http://<ip>:<port>` (drop `KUBEDECK_TRUST_PROXY_NETWORK`). Point the Service at port 5000. There is then **no login**: anyone who reaches it has KubeDeck's cluster access, so add `KUBEDECK_READ_ONLY=true` unless you mean otherwise. Details in [WEB.md](WEB.md#no-sign-in-kubedeck_authnone).

## 5. Deploy

```sh
kubectl apply -f deploy/kubernetes/kubedeck.yaml
kubectl -n kubedeck rollout status deploy/kubedeck
```

This creates the namespace, a service account with a read cluster role (no secrets) and an operator role for changes and pod files, the Deployment (KubeDeck + oauth2-proxy), a Service and an Ingress.

## 6. Check it works

1. Open `https://<your-host>`. You should be sent to Keycloak, then land on the Overview with your name and a sign-out icon in the header.
2. Check the features: Ask Deck answers (if the `kubedeck-ai` Secret exists; otherwise its avatar shows offline), a pod's **Files** tab lists the container's files, and a deployment's actions offer scale / restart. Port-forward is absent by design, and Settings shows only Appearance and About.
3. Logs and live updates: open a pod's **Logs** tab; lines should stream.
4. From the command line:

```sh
kubectl -n kubedeck get pods                              # 2/2 Running
kubectl -n kubedeck logs deploy/kubedeck -c kubedeck      # "running in a pod: using the service account…"
kubectl -n kubedeck logs deploy/kubedeck -c oauth2-proxy  # login activity
```

## What users can see

**Everyone who signs in can do whatever the service account can do.** The login decides who may *enter*; Kubernetes RBAC on the `kubedeck` service account decides what they can *read* and *change*, from the UI and through the assistant. `kubedeck-reader` covers pods, logs, events, namespaces, nodes, services, workloads, jobs, ingresses and metrics, and deliberately **not secrets**. `kubedeck-operator` adds changes to those workloads and `pods/exec` for pod files; delete it (and set `KUBEDECK_READ_ONLY=true`) for a look-only KubeDeck.

To give each person their own permissions instead, turn on impersonation (`KUBEDECK_ACCESS=impersonate`, see [WEB.md](WEB.md#per-user-permissions-kubedeck_accessimpersonate)): KubeDeck then acts as the signed-in user and their Keycloak groups, and the service account needs only the `kubedeck-impersonator` role from the manifest. Bind your existing roles to those users and groups first.

### Several clusters

In a pod KubeDeck shows **one** cluster: the one it runs in (context `in-cluster`). Options for more:
- Deploy one KubeDeck per cluster (simplest, and each keeps its own service account and RBAC).
- Mount a kubeconfig as a Secret and set `KUBECONFIG` to it. KubeDeck then lists every context in that file, and every user gets that file's access. Use only credentials you are happy to share with all signed-in users, and prefer read-only ones.

## Operations

**Audit trail.** Every write attempt, kubectl palette command and assistant request is logged to stdout as one JSON line with the user's email; the assistant's approvals and changes are logged as `[kubedeck:agent]` lines naming the user:

```sh
kubectl -n kubedeck logs deploy/kubedeck -c kubedeck | grep '"audit":true'
```

**Upgrade.** Change the image tag and apply; the single replica restarts in a few seconds (state is only in users' browsers).

```sh
kubectl -n kubedeck set image deploy/kubedeck kubedeck=swapnilsaal/kubedeck:<new-tag>
kubectl -n kubedeck rollout status deploy/kubedeck
```

**Roll back.** `kubectl -n kubedeck rollout undo deploy/kubedeck`

**Remove.** `kubectl delete -f deploy/kubernetes/kubedeck.yaml` and `kubectl delete secret -n kubedeck kubedeck-oauth`. (Deleting the namespace removes everything in it; the cluster role and binding are cluster-wide and are deleted by the command above.)

## Troubleshooting

| You see | Likely cause |
|---|---|
| Keycloak: *Invalid redirect URI* | the redirect URI in step 2 is not exactly `https://<host>/oauth2/callback` |
| Login loops back to Keycloak | cookie secret not 16/24/32 bytes; or `--cookie-secure=true` on plain HTTP; or the browser blocks the cookie (host mismatch) |
| `403 … must come through the KubeDeck login proxy` | you reached KubeDeck without the sidecar (a port-forward to port 5000, or `HOST` not `127.0.0.1` with `KUBEDECK_TRUST_PROXY_NETWORK=1`). Always go through the ingress / port 4180 |
| `403 KubeDeck only accepts requests from its own window` | the hostname you used is not the one in `KUBEDECK_PUBLIC_URL` |
| `401 Sign in required` | the proxy sent no user headers; check oauth2-proxy runs with `--pass-user-headers=true` |
| `403 not in a group` | the user is not in `KUBEDECK_ALLOWED_GROUPS`, or the groups mapper (step 2) is missing |
| Pod `CrashLoopBackOff`, log says *Web mode needs a way to know requests came through your login proxy* | a required setting is missing; the message names it (`KUBEDECK_PUBLIC_URL`, and the sidecar/secret trust setting) |
| Empty Overview, "Access denied" | the service account lacks permission for that namespace or resource; extend the `ClusterRole` |
| No CPU / memory usage | metrics-server missing, or the role lacks `metrics.k8s.io` |
| Logs stop after a minute | the ingress is buffering or timing out streams; keep the `proxy-read-timeout` and `proxy-buffering: "off"` annotations (nginx), or the equivalent for your controller |

## Security checklist

- [ ] `--email-domain` (or `--allowed-group`) narrowed from `*`
- [ ] TLS on the ingress, and `--cookie-secure=true` (the default in the manifest)
- [ ] Service account role reviewed; **secrets not included** unless every user may read every secret
- [ ] `kubedeck-operator` kept only if every signed-in user may change workloads and read pod files; otherwise delete it and set `KUBEDECK_READ_ONLY=true`
- [ ] the AI provider is one your organisation allows cluster data to be sent to (or `KUBEDECK_AI=off`)
- [ ] Optionally a NetworkPolicy so only the ingress controller can reach port 4180 (KubeDeck itself is already unreachable except through the sidecar)
- [ ] Image pulled by an exact tag (not `latest`); registry credentials stored as a Secret, not in the manifest
- [ ] Keycloak client secret rotated if it was ever pasted into a chat, ticket or file

## What has and has not been tested

Tested: the image builds and runs as uid 1000 on amd64 and arm64; the login gate, host check, feature switches, read-only rules and in-cluster context creation behave as described (with a fake service-account token); with a real cluster and AI provider, the assistant answers, runs shell-free pipelines, refuses `config view --raw`, and in read-only mode refuses changes without asking; pod files list a real pod; the manifest parses.

**Not yet tested end to end:** a real deployment on a cluster, the real Keycloak login, and that your oauth2-proxy version sends the user and group headers under the names KubeDeck reads (`X-Forwarded-User`, `-Email`, `-Preferred-Username`, `-Groups`). Check these on the first deploy: if the page says *Sign in required* after a successful login, the headers are the first thing to look at.
