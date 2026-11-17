# Deploying KubeDeck (web) to Kubernetes

A step-by-step runbook for running KubeDeck as a shared web service with its own sign-in. For *why* it works this way, see [WEB.md](WEB.md).

```
browser ──HTTPS──▶ ingress ──▶ KubeDeck ──kubectl --kubeconfig=<cluster's connection> --as=system:serviceaccount:<ns>:<name>──▶ Kubernetes API
                               (one pod, SQLite on a 1 GB volume)                                                   RBAC decides
```

Web mode reads no kubeconfig from disk. After deploying, an admin adds clusters under **Settings → Clusters**, creates groups with a service account on each cluster under **Settings → Groups**, and adds people to groups under **Settings → Users**.

## What you need

| | |
|---|---|
| A Kubernetes cluster | with an ingress controller (the manifest uses `nginx`) and a TLS certificate for your hostname |
| A hostname | e.g. `kubedeck.example.com`, pointing at the ingress |
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
  --from-literal=admin-email='you@example.com' \
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

This creates the namespace, the `kubedeck` service account, a 1 GiB volume for the database, the Deployment, a Service and an Ingress. The manifest's `kubedeck-impersonator` ClusterRole grants `impersonate` on `users` and `groups`, which this version no longer uses; see step 5 for what to give instead.

## 5. Connect clusters

On each kubectl call KubeDeck runs as the service accounts the person's groups have on that cluster (Settings → Groups), in the groups' order; the next one is tried when the cluster answers Forbidden, so permissions add up. Someone with no group on a cluster, a KubeDeck admin included, has no access there. KubeDeck never acts as the person themselves or as its own connection.

Each cluster needs a connection: the credentials KubeDeck itself uses for it, added under **Settings → Clusters** after you sign in (step 6).

- **The cluster KubeDeck runs in:** choose **This cluster**. It uses the pod's `kubedeck` service account, which then needs `impersonate` on each service account your groups will use. Uncomment the `serviceaccounts` rule in the manifest's `kubedeck-impersonator` role and name each account in `resourceNames`:

  ```yaml
  - apiGroups: [""]
    resources: [serviceaccounts]
    resourceNames: [shop-editor, shop-viewer]
    verbs: [impersonate]
  ```

  You can drop that role's `users` / `groups` rule.
- **Other clusters:** upload a kubeconfig whose user is a service account token or an inline client certificate (exec plugins and file paths are refused), with the same `impersonate` rights on that cluster.
- **Optional, per connection:** `list` on `namespaces` and `serviceaccounts` so the group form can offer them (otherwise you type the names).

Where a connection may not impersonate, a group can upload its service account's kubeconfig instead.

## 6. Set it up and check it works

1. Open `https://<your-host>` and sign in with the admin email and password from step 2. The cluster picker is empty: nobody has a group yet.
2. **Settings → Clusters**: add each cluster (step 5).
3. **Settings → Groups**: create your groups and give each a service account per cluster.
4. **Settings → Users**: add yourself to a group, then add people (name, email, a generated password, groups). Give each person their password; they can sign in at once.
5. Check the features: lists show what your groups allow, a deployment's actions offer scale / restart where you may change it, Ask Deck answers (if the `kubedeck-ai` Secret exists), a pod's **Logs** tab streams.
6. **Settings → Audit log** lists every change with who made it.
7. From the command line:

```sh
kubectl -n kubedeck get pods                 # 1/1 Running
kubectl -n kubedeck logs deploy/kubedeck     # "database: sqlite /data/kubedeck.db", "Created the first admin…"
```

## Several clusters

One KubeDeck serves as many clusters as an admin adds under **Settings → Clusters**, each with an uploaded kubeconfig (step 5). The kubeconfigs are stored encrypted in the database; nothing is mounted, and `KUBECONFIG` is ignored. Each cluster's API server must be reachable from the KubeDeck pod. **Upload a new kubeconfig** on a cluster's row reconnects it when its token expires.

## Operations

**Audit trail.** Every change is in **Settings → Audit log** and on stdout as one JSON line with the person:

```sh
kubectl -n kubedeck logs deploy/kubedeck | grep '"audit":true'
```

**Back up** the database: with SQLite, copy `/data/kubedeck.db` (accounts, clusters, groups and the audit log) from the volume, or snapshot the volume. Keep `KUBEDECK_AUTH_SECRET` with it: without it, uploaded kubeconfigs cannot be decrypted.

**Upgrade.** Change the image tag and apply; the pod is replaced (a few seconds of downtime with SQLite).

```sh
kubectl -n kubedeck set image deploy/kubedeck kubedeck=swapnilsaal/kubedeck:<new-tag>
kubectl -n kubedeck rollout status deploy/kubedeck
```

**Roll back.** `kubectl -n kubedeck rollout undo deploy/kubedeck`

**Remove.** `kubectl delete -f deploy/kubernetes/kubedeck.yaml` and `kubectl delete secret -n kubedeck kubedeck-auth kubedeck-ai`. Deleting the namespace also deletes the volume, and with it every account, cluster, group and the audit log.

## Troubleshooting

| You see | Likely cause |
|---|---|
| Pod `CrashLoopBackOff`, log names a setting | a required setting is missing (`KUBEDECK_AUTH_SECRET` under 32 characters, `KUBEDECK_PUBLIC_URL` missing); the message says which |
| `403 KubeDeck only accepts requests from its own window` | the hostname you used is not the one in `KUBEDECK_PUBLIC_URL` |
| Sign-in says the email and password do not match | wrong password; an admin can set a new one under Settings → Users |
| `Too many attempts` on sign-in | 10 tries a minute per address. Behind an ingress, check `KUBEDECK_PROXY_HOPS=1` is set, or everyone shares one limit |
| Cluster picker says "No clusters for you yet", or "none of your KubeDeck groups gives you access to cluster …" | none of the person's groups has a service account on that cluster (admins too): add the cluster under Settings → Clusters, give a group of theirs a service account on it, put them in that group |
| Signed in, but everything is empty or "Access denied" | the group's service account has no RoleBinding for that namespace (the group's **RBAC** menu opens them), or the cluster's connection lacks `impersonate` on it (step 5) |
| Log: `Cluster <name>: its connection cannot be read …` | `KUBEDECK_AUTH_SECRET` changed (upload a new kubeconfig on the cluster's row), or a **This cluster** connection while KubeDeck no longer runs in a pod |
| Log: `KUBEDECK_ACCESS is no longer used …` (or an `…IMPERSONATE…` variable) | a retired setting is still in the manifest; remove it |
| `403 not in a group` | the person is not in `KUBEDECK_ALLOWED_GROUPS` |
| No CPU / memory usage | metrics-server missing, or the person's role lacks `metrics.k8s.io` |
| Logs stop after a minute | the ingress is buffering or timing out streams; keep the `proxy-read-timeout` and `proxy-buffering: "off"` annotations (nginx), or the equivalent for your controller |

## Security checklist

- [ ] TLS on the ingress (session cookies are marked secure when `KUBEDECK_PUBLIC_URL` is `https`)
- [ ] `KUBEDECK_AUTH_SECRET` random and stored only in the Secret
- [ ] Each cluster's connection may impersonate only the service accounts groups use (`resourceNames`)
- [ ] Groups' service accounts bound to the narrowest roles that work; **secrets** readable only by service accounts that may read every secret in that namespace
- [ ] The KubeDeck admin role only for people you trust to put anyone in any group
- [ ] The first admin's password changed after first sign-in if it was ever pasted anywhere
- [ ] The AI provider is one your organisation allows cluster data to be sent to (or `KUBEDECK_AI=off`)
- [ ] The database volume backed up
- [ ] Image pulled by an exact tag (not `latest`); registry credentials stored as a Secret, not in the manifest

## What has and has not been tested

Tested: sign-in, admin-only user management, group changes, blocking and the audit log end to end over HTTP, against both SQLite and Postgres 17; the production bundle running against each; the image deployed with this manifest to a kind cluster (Kubernetes 1.31): the pod runs as uid 1000, keeps the database on its volume across restarts (accounts, sessions and the audit log survive). Those runs predate clusters under Settings → Clusters: the cluster connections and the service-account-only access described here have not been through the same end-to-end run with this manifest.

**Not yet tested end to end:** Postgres with several replicas behind an ingress, and the published multi-arch image of this version (it is not released yet).
