---
title: "Deploy on Kubernetes"
description: "Deploy KubeDeck's web mode into a cluster with the bundled manifest, sign in as the first admin, and connect the clusters your team will use."
---

# Deploy on Kubernetes

The repository ships one manifest, `deploy/kubernetes/kubedeck.yaml`, that runs KubeDeck's web mode in a cluster. It runs one pod with SQLite on a small volume, behind an nginx ingress. This page walks through it, then explains how KubeDeck connects to the cluster it runs in and to others.

## What you need

| | |
|---|---|
| A cluster | With an ingress controller (the manifest uses `ingressClassName: nginx`) and a TLS certificate for your hostname. |
| A hostname | For example `kubedeck.example.com`, pointing at the ingress. |
| A storage class | For one 1Gi `ReadWriteOnce` volume. The cluster's default class is fine. |
| `kubectl` access | Enough to create a namespace, cluster-wide RBAC and a Deployment. |
| The image | `swapnilsaal/kubedeck:<version>-web`, or your own build. See [Run with Docker](/web/docker). |

## Deploy

::: steps
::: step "Create the namespace and the sign-in secret"
Secrets are created with `kubectl`, never written into the manifest.

```bash
kubectl create namespace kubedeck

kubectl -n kubedeck create secret generic kubedeck-auth \
  --from-literal=secret="$(openssl rand -base64 32)" \
  --from-literal=admin-email='admin@example.com' \
  --from-literal=admin-password="$(openssl rand -base64 18)"
```

Read the first admin's password back when you need it:

```bash
kubectl -n kubedeck get secret kubedeck-auth -o jsonpath='{.data.admin-password}' | base64 -d; echo
```

`secret` must be at least 32 characters and must stay the same. Changing it signs everyone out and makes stored kubeconfigs and plugin secrets unreadable.
::: /step

::: step "Optional: add the AI provider"
The manifest reads the provider from a `kubedeck-ai` secret. Every key is optional, so the pod starts without it.

```bash
kubectl -n kubedeck create secret generic kubedeck-ai \
  --from-literal=provider='anthropic' \
  --from-literal=api-key='<the provider key>'
```

Other keys it reads: `model`, `fast-model`, `base-url`. An admin can also set the provider later in **Settings → AI assistant**. See [AI providers](/integrations/ai-providers).
::: /step

::: step "Edit the manifest"
Open `deploy/kubernetes/kubedeck.yaml` and change:

| Find | Replace with |
|---|---|
| `kubedeck.example.com` (in `KUBEDECK_PUBLIC_URL`, the Ingress `tls` and `rules`) | Your hostname. |
| `secretName: CHANGE_ME-tls` | Your TLS secret, or remove `tls` and use your certificate manager's annotation. |
| `image:` | Your image, if you do not use the published one. |

Optional switches go in the container's `env`. See [Configuration](/web/configuration) for all of them.
::: /step

::: step "Apply it"
```bash
kubectl apply -f deploy/kubernetes/kubedeck.yaml
kubectl -n kubedeck rollout status deploy/kubedeck
kubectl -n kubedeck logs deploy/kubedeck
```

The log should show `database: sqlite /data/kubedeck.db` and `Created the first admin, admin@example.com. Sign in and add users under Settings → Users.`
::: /step

::: step "Sign in and add clusters"
Open `https://<your host>` and sign in with the admin email and password. The scope switcher is empty: web mode reads no kubeconfig, and nobody, the admin included, reaches a cluster yet.

Open **Settings → Clusters → Add cluster**. For the cluster KubeDeck runs in, choose **This cluster**: it uses the pod's service account `kubedeck`. Give that account the RBAC in [Use this cluster](#deploy-on-kubernetes-use-this-cluster). For other clusters, upload a kubeconfig. See [Clusters](/web/clusters).
::: /step

::: step "Create groups with service accounts"
**Settings → Groups → New group**: name it, add a cluster, and pick the service account its people act as there. See [Groups and cluster access](/web/groups).
::: /step

::: step "Add people to groups"
**Settings → Users**: open your own account and add yourself to a group. Then **Add person** for everyone else: name, email, a generated password, and their groups. Give each person their password; they can sign in at once. See [Users and roles](/web/users).
::: /step
::: /steps

## What the manifest creates

| Object | Name | Notes |
|---|---|---|
| Namespace | `kubedeck` | Also created by the first step; `apply` adopts it. |
| ServiceAccount | `kubedeck` | The pod's identity. KubeDeck uses it only if an admin adds this cluster as **This cluster**. |
| ClusterRole and ClusterRoleBinding | `kubedeck-impersonator` | `impersonate` on `users` and `groups`, which this version no longer uses. A commented rule shows `impersonate` on named `serviceaccounts`, which is what **This cluster** needs. |
| PersistentVolumeClaim | `kubedeck-data` | 1Gi `ReadWriteOnce`, mounted at `/data`. |
| Deployment | `kubedeck` | One replica, `Recreate` strategy, so only one pod opens the SQLite file. |
| Service | `kubedeck` | Port 80 to the container's port 5000. |
| Ingress | `kubedeck` | `nginx`, with `proxy-read-timeout: "3600"` and `proxy-buffering: "off"` for live log streams. |

The pod runs as uid 1000 with a read-only root filesystem, no privilege escalation, all capabilities dropped and the `RuntimeDefault` seccomp profile. `/tmp` is an `emptyDir` in memory (`medium: Memory`, 32 MiB), so the decrypted kubeconfigs `kubectl` reads never reach the node's disk. Readiness and liveness probes call `GET /healthz`, which answers `ok` without a session.

The container sets `KUBEDECK_PROXY_HOPS=1` for the ingress, and `KUBEDECK_DATABASE_URL=sqlite:/data/kubedeck.db`. It requests 100m CPU and 192Mi memory, with a 512Mi memory limit.

Web mode never reads a kubeconfig from disk, in a pod or anywhere else. At start it points `KUBECONFIG` at an empty file and logs `Clusters come from Settings → Clusters; people reach a cluster through their groups' service accounts (Settings → Groups).`

## Use this cluster

When an admin adds the cluster KubeDeck runs in as **This cluster**, the `kubedeck` service account becomes that cluster's connection. KubeDeck never uses it otherwise, and never runs a person's call as it. People act as their groups' service accounts, which KubeDeck impersonates through it.

Give it only what you use. The full list is in [What the connection needs](/web/clusters#clusters-what-the-connection-needs):

- `impersonate` on each service account groups pick, named with `resourceNames`,
- `list` on `namespaces`, and on `serviceaccounts`, so the group form can offer them.

The manifest's `kubedeck-impersonator` ClusterRole has a commented rule for the first. Uncomment it and name your service accounts, rather than allowing all of them:

```yaml
rules:
  - apiGroups: [""]
    resources: [serviceaccounts]
    resourceNames: [shop-editor, shop-viewer]
    verbs: [impersonate]
```

Its `impersonate` rule on `users` and `groups` is from before clusters and groups were set up in KubeDeck. This version does not use it, so you can remove it.

::: callout warning title:"Pick names, not every service account"
The connection can impersonate whatever its RBAC allows, and an admin picks the service account in **Settings → Groups**. With `impersonate` on all service accounts, an admin could pick one in `kube-system`. Name each one.
:::

Where the connection may not impersonate, a group can upload its service account's kubeconfig instead. See [Groups and cluster access](/web/groups).

## Several clusters

One KubeDeck can serve many clusters. Add each one in **Settings → Clusters** with a kubeconfig for KubeDeck: a service account token or an inline client certificate. Give that identity the same RBAC as above, on its own cluster. KubeDeck stores the kubeconfig encrypted in its database. See [Clusters](/web/clusters).

The image contains only `kubectl` and `jq`, and uploads that run a program to sign in are refused. Each cluster's API server must be reachable from the KubeDeck pod.

## Several replicas

SQLite needs exactly one pod. For more, set `KUBEDECK_DATABASE_URL` to Postgres (the manifest has a commented `kubedeck-db` secret reference), remove the volume and the `Recreate` strategy, and raise `replicas`. See [Database](/web/database).

## Upgrade, roll back, remove

```bash
# upgrade: the pod is replaced (a short gap with SQLite and Recreate)
kubectl -n kubedeck set image deploy/kubedeck kubedeck=swapnilsaal/kubedeck:<new version>-web
kubectl -n kubedeck rollout status deploy/kubedeck

# roll back
kubectl -n kubedeck rollout undo deploy/kubedeck

# remove
kubectl delete -f deploy/kubernetes/kubedeck.yaml
kubectl -n kubedeck delete secret kubedeck-auth kubedeck-ai
```

::: callout danger title:"Deleting the namespace deletes the data"
The volume holds every account, cluster, group and the audit log. Back it up first. See [Database](/web/database).
:::

Before you open it to your team, go through the [Security model](/web/security) checklist.
