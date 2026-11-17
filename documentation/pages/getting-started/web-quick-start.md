---
title: "Quick start (shared web)"
description: "Start KubeDeck in web mode, locally from source or with Docker, and sign in as its first admin."
---

# Quick start (shared web)

Web mode turns KubeDeck into a shared service for a team. It signs people in itself, an admin adds the clusters it may reach, and each person acts in a cluster as the service accounts their groups have there, so Kubernetes RBAC decides what they see and change. This page gets one instance running on your machine so you can sign in, add a cluster and look around.

For a real deployment, go to [Deploy on Kubernetes](/web/deploy-kubernetes) after this.

## What web mode needs

KubeDeck refuses to start in web mode until these are set. The error message names what is missing.

| Variable | Meaning |
|---|---|
| `KUBEDECK_MODE` | `web`. The Docker image already sets it. |
| `KUBEDECK_PUBLIC_URL` | The URL people open, such as `http://localhost:5051`. Requests for any other hostname are refused. |
| `KUBEDECK_AUTH_SECRET` | At least 32 random characters that sign sessions. Generate it with `openssl rand -base64 32`, and keep it: changing it signs everyone out. |
| `KUBEDECK_ADMIN_EMAIL` / `KUBEDECK_ADMIN_PASSWORD` | The first admin, created at start if that email does not exist yet. The password needs at least 12 characters. An existing account is never changed. |
| `KUBEDECK_DATABASE_URL` | Where accounts, groups, projects and the audit log live. Set it in a container, for example `sqlite:/data/kubedeck.db` on a volume. Without it, KubeDeck uses `~/.kubedeck/kubedeck.db`. |

Every other setting is in [Configuration](/web/configuration).

## Option 1: from source

Use this when you already have the repository. Run it from the repository root after `npm install`:

```bash
KUBEDECK_MODE=web KUBEDECK_PUBLIC_URL=http://localhost:5051 \
KUBEDECK_AUTH_SECRET="$(openssl rand -base64 32)" \
KUBEDECK_ADMIN_EMAIL=admin@example.com KUBEDECK_ADMIN_PASSWORD='choose-a-long-one' \
PORT=5051 npm run dev
```

Open `http://localhost:5051`. Web mode does not read the kubeconfig of the shell you started it from: you add clusters after you sign in.

## Option 2: Docker

No kubeconfig is mounted: you add clusters after you sign in. Keep the auth secret in a variable, so a restart does not sign everyone out:

```bash
export KUBEDECK_AUTH_SECRET="$(openssl rand -base64 32)"
mkdir -p kubedeck-data

docker run --rm -p 5000:5000 \
  -e KUBEDECK_PUBLIC_URL=http://localhost:5000 \
  -e KUBEDECK_AUTH_SECRET \
  -e KUBEDECK_DATABASE_URL=sqlite:/data/kubedeck.db \
  -e KUBEDECK_ADMIN_EMAIL=admin@example.com \
  -e KUBEDECK_ADMIN_PASSWORD='choose-a-long-one' \
  -v "$PWD/kubedeck-data:/data" \
  swapnilsaal/kubedeck:<version>-web
```

Open `http://localhost:5000`. The image listens on port `5000`.

::: callout warning title:"Things that trip up a first Docker run"
- The container runs as uid `1000`. The data folder must be writable by that user.
- The kubeconfigs you upload are used from inside the container. A server address of `127.0.0.1` or `localhost` points at the container, not at your machine.
- Open the exact hostname in `KUBEDECK_PUBLIC_URL`. With `localhost` there, `http://127.0.0.1:5000` is refused.
:::

More options, such as Postgres and the AI provider variables, are in [Run with Docker](/web/docker).

## Sign in for the first time

::: steps
::: step "Open the sign-in page"
Open the public URL. KubeDeck shows **Sign in** with **Email** and **Password**. There is no self sign-up.
::: /step
::: step "Sign in as the admin"
Use `KUBEDECK_ADMIN_EMAIL` and `KUBEDECK_ADMIN_PASSWORD`. Sessions last 12 hours.
::: /step
::: step "Add a cluster"
Open **Settings → Clusters** and choose **Add cluster**. Name it, for example `dev`, and upload a kubeconfig for KubeDeck to use there. It must hold a token or an inline client certificate: exec plugins, such as a cloud provider's CLI, are refused. For a local kind or Docker Desktop cluster, write one context with its credentials inline:

```bash
kubectl config view --minify --flatten --context=<your context> > dev.yaml
```

See [Clusters](/web/clusters).
::: /step
::: step "Create a group with a service account"
Open **Settings → Groups** and choose **New group**. Add the cluster, pick a namespace and one of its service accounts, and choose **Create group**. On a local cluster, `deploy/demo/kubedeck-demo.yaml` creates demo workloads and the service accounts `shop/shop-viewer` (view in `shop`) and `shop/shop-editor` (edit in `shop`) to try.
::: /step
::: step "Add people to the group, yourself too"
Open **Settings → Users**. Open your own account, add the group, and save. Add other people with **Add person**. Nobody reaches a cluster without a group that has a service account on it, admins included.
::: /step
::: step "Look at the cluster"
Pick the cluster in the scope switcher. Everything you see is what the group's service account may see.
::: /step
::: /steps

::: callout tip
An admin can add clusters, put themselves in any group, and change what a group's service account may do where the cluster's connection allows it. Make someone an admin only if you trust them with that.
:::

## Next steps

::: card title:"Clusters" icon:network
Add clusters and give KubeDeck the RBAC it needs on each: [Clusters](/web/clusters).
::: /card

::: card title:"Groups and cluster access" icon:users
Give each team its own identity per cluster: [Groups and cluster access](/web/groups).
::: /card

::: card title:"Deploy on Kubernetes" icon:server
Run it for real with the provided manifest: [Deploy on Kubernetes](/web/deploy-kubernetes).
::: /card
