# Deploying KubeDeck (web) to Kubernetes

A step-by-step runbook for running KubeDeck as a shared web service with its own sign-in. For *why* it works this way, see [WEB.md](WEB.md).

```
browser ──HTTPS──▶ ingress ──▶ KubeDeck ──kubectl --as=kubedeck:<email> --as-group=kubedeck:<group>──▶ Kubernetes API
                               (one pod, SQLite on a 1 GB volume)                                     RBAC decides
```

## What you need

| | |
|---|---|
| A Kubernetes cluster | with an ingress controller (the manifest uses `nginx`) and a TLS certificate for your hostname |
| A hostname | e.g. `kubedeck.yourcompany.com`, pointing at the ingress |
| A storage class | for one 1 GiB `ReadWriteOnce` volume (the cluster's default is fine) |
| `kubectl` access | able to create a namespace, cluster RBAC and a Deployment |
| The image | `swapnilsaal/kubedeck:<version>-web` on Docker Hub, or build your own (below) |

## 1. The image

Use the published image as-is, or build and push your own:

```sh
script/docker-build.sh                       # local build for this machine: swapnilsaal/kubedeck:<version>-web
script/docker-build.sh --push                # amd64 + arm64, pushed as one tag (needs docker login)
# your own registry, both architectures:
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/kubedeck:<version>-web --push .
```

The image covers `linux/amd64` and `linux/arm64`, runs as the non-root user uid 1000 (`node`), contains `kubectl` and `jq`, and contains **no kubeconfig and no secrets**. If your registry is private, add an `imagePullSecrets` entry to the pod spec.

## 2. Create the namespace and secrets

Secrets are created with `kubectl`, never written into the YAML:

```sh
kubectl create namespace kubedeck

kubectl -n kubedeck create secret generic kubedeck-auth \
  --from-literal=secret="$(openssl rand -base64 32)" \
  --from-literal=admin-email='you@yourcompany.com' \
  --from-literal=admin-password="$(openssl rand -base64 18)"

# the first admin's password, to sign in with:
kubectl -n kubedeck get secret kubedeck-auth -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

For the AI assistant, add the provider (skip this and the assistant shows as offline; `KUBEDECK_AI=off` hides it):

```sh
kubectl -n kubedeck create secret generic kubedeck-ai \
  --from-literal=provider='anthropic' \
  --from-literal=api-key='<the provider key>'
# optional keys: model, fast-model, base-url (base-url is required for provider=custom)
```

The manifest also declares the namespace, so the later `kubectl apply` simply adopts it (a harmless warning about a missing annotation is normal).

## 3. Edit the manifest

Open `deploy/kubernetes/kubedeck.yaml` and change:

| Find | Replace with |
|---|---|
| `kubedeck.example.com` (3 places: `KUBEDECK_PUBLIC_URL`, Ingress `tls` and `rules`) | your hostname |
| `secretName: CHANGE_ME-tls` | the name of your TLS secret (or remove `tls` and use your cert-manager annotation) |
| `image:` | your image, if not using the published one |

Optional settings (environment variables on the `kubedeck` container):

| Variable | Effect |
|---|---|
| `KUBEDECK_ALLOWED_GROUPS=platform,sre` | a person must be in one of these KubeDeck groups to use KubeDeck at all |
| `KUBEDECK_READ_ONLY=true` | refuse scale / restart / edit / delete for everyone, including the assistant |
| `KUBEDECK_AI=off` | hide the assistant and every AI feature |
| `KUBEDECK_POD_FILES=off` | hide the pod Files tab |
| `KUBEDECK_DATABASE_URL=postgres://…` | Postgres instead of the SQLite file: needed for more than one replica (then drop the volume and the `Recreate` strategy) |

## 4. Deploy

```sh
kubectl apply -f deploy/kubernetes/kubedeck.yaml
kubectl -n kubedeck rollout status deploy/kubedeck
```

This creates the namespace, a service account that may only impersonate users and groups, a 1 GiB volume for the database, the Deployment, a Service and an Ingress.

## 5. Give groups their permissions

KubeDeck acts as each person (`kubedeck:<email>`) and their groups (`kubedeck:<group>`). Bind the groups you plan to use to roles, per namespace or cluster-wide:

```sh
kubectl create clusterrolebinding kubedeck-viewers --clusterrole=view --group=kubedeck:viewers
kubectl create rolebinding kubedeck-shop-editors --clusterrole=edit --group=kubedeck:shop-editors -n shop
kubectl create clusterrolebinding kubedeck-admins --clusterrole=cluster-admin --group=kubedeck:admins   # only if you mean it
```

Someone in no bound group signs in and sees nothing. Put the first admin in a group too (step 6), or they can manage users but see no cluster.

## 6. Check it works

1. Open `https://<your-host>` and sign in with the admin email and password from step 2.
2. **Settings → Users**: put yourself in a group from step 5, then add people (name, email, a generated password, groups). Give each person their password; they can sign in at once.
3. Check the features: lists show what your groups allow, a deployment's actions offer scale / restart where you may change it, Ask Deck answers (if the `kubedeck-ai` Secret exists), a pod's **Logs** tab streams.
4. **Settings → Audit log** lists every change with who made it.
5. From the command line:

```sh
kubectl -n kubedeck get pods                 # 1/1 Running
kubectl -n kubedeck logs deploy/kubedeck     # "database: sqlite /data/kubedeck.db", "Created the first admin…"
```

## Several clusters

In a pod KubeDeck shows **one** cluster: the one it runs in (context `in-cluster`). Options for more:
- Deploy one KubeDeck per cluster (simplest; each has its own accounts unless they share a Postgres database).
- Mount a kubeconfig as a Secret and set `KUBECONFIG` to it. KubeDeck lists every context in that file and impersonates people in each, so its credentials there need `impersonate` and the groups need bindings in every cluster.

## Operations

**Audit trail.** Every change is in **Settings → Audit log** and on stdout as one JSON line with the person:

```sh
kubectl -n kubedeck logs deploy/kubedeck | grep '"audit":true'
```

**Back up** the database: with SQLite, copy `/data/kubedeck.db` (accounts and audit log) from the volume, or snapshot the volume.

**Upgrade.** Change the image tag and apply; the pod is replaced (a few seconds of downtime with SQLite).

```sh
kubectl -n kubedeck set image deploy/kubedeck kubedeck=swapnilsaal/kubedeck:<new-tag>
kubectl -n kubedeck rollout status deploy/kubedeck
```

**Roll back.** `kubectl -n kubedeck rollout undo deploy/kubedeck`

**Remove.** `kubectl delete -f deploy/kubernetes/kubedeck.yaml` and `kubectl delete secret -n kubedeck kubedeck-auth kubedeck-ai`. Deleting the namespace also deletes the volume, and with it every account and the audit log.

## Troubleshooting

| You see | Likely cause |
|---|---|
| Pod `CrashLoopBackOff`, log names a setting | a required setting is missing (`KUBEDECK_AUTH_SECRET` under 32 characters, `KUBEDECK_PUBLIC_URL` missing); the message says which |
| `403 KubeDeck only accepts requests from its own window` | the hostname you used is not the one in `KUBEDECK_PUBLIC_URL` |
| Sign-in says the email and password do not match | wrong password; an admin can set a new one under Settings → Users |
| `Too many attempts` on sign-in | 10 tries a minute per address. Behind an ingress, check `KUBEDECK_PROXY_HOPS=1` is set, or everyone shares one limit |
| Signed in, but everything is empty or "Access denied" | the person's groups have no RoleBinding for that namespace (step 5), or the service account lacks `impersonate` |
| `403 not in a group` | the person is not in `KUBEDECK_ALLOWED_GROUPS` |
| No CPU / memory usage | metrics-server missing, or the person's role lacks `metrics.k8s.io` |
| Logs stop after a minute | the ingress is buffering or timing out streams; keep the `proxy-read-timeout` and `proxy-buffering: "off"` annotations (nginx), or the equivalent for your controller |

## Security checklist

- [ ] TLS on the ingress (session cookies are marked secure when `KUBEDECK_PUBLIC_URL` is `https`)
- [ ] `KUBEDECK_AUTH_SECRET` random and stored only in the Secret
- [ ] Groups bound to the narrowest roles that work; `cluster-admin` only for the few who need it; **secrets** readable only by groups that may read every secret in that namespace
- [ ] The first admin's password changed after first sign-in if it was ever pasted anywhere
- [ ] The AI provider is one your organisation allows cluster data to be sent to (or `KUBEDECK_AI=off`)
- [ ] The database volume backed up
- [ ] Image pulled by an exact tag (not `latest`); registry credentials stored as a Secret, not in the manifest

## What has and has not been tested

Tested: sign-in, admin-only user management, group changes, blocking and the audit log end to end over HTTP with a real SQLite database; impersonation against a real kind cluster (a `shop-viewers` user reads `shop` only, a `shop-editors` user can scale there); the production bundle runs with SQLite; the manifest parses.

**Not yet tested end to end:** a deployment of the image on a cluster with the volume, and Postgres. Check the first deploy against step 6.
