---
title: "Run with Docker"
description: "Run KubeDeck's web image with Docker and a data volume, add your clusters, or build the image yourself."
---

# Run with Docker

The web image runs KubeDeck's shared web mode in one container. Use it to try web mode on your machine, or to run it on a host outside Kubernetes. For a cluster, use [Deploy on Kubernetes](/web/deploy-kubernetes) instead.

## The image

| | |
|---|---|
| Name | `swapnilsaal/kubedeck:<version>-web` on Docker Hub |
| Platforms | `linux/amd64` and `linux/arm64` |
| User | uid 1000 (the base image's `node` user) |
| Contents | The KubeDeck server bundle, `kubectl` (`v1.31.4` by default, the `KUBECTL_VERSION` build argument) and `jq`. No kubeconfig and no secrets. |
| Preset environment | `NODE_ENV=production`, `KUBEDECK_MODE=web`, `PORT=5000`, `KUBECACHEDIR=/tmp/kube-cache` |
| Port | 5000 |
| Health | `GET /healthz` answers `ok`. The image has no `HEALTHCHECK`; probes belong to your orchestrator. |

## Run it

::: steps
::: step "Write an environment file"
Generate the secret once and keep it. A new secret signs everyone out and makes stored kubeconfigs unreadable. No kubeconfig is mounted: web mode never reads one from disk.

```bash
cat > kubedeck.env <<EOF
KUBEDECK_PUBLIC_URL=http://localhost:5000
KUBEDECK_AUTH_SECRET=$(openssl rand -base64 32)
KUBEDECK_ADMIN_EMAIL=admin@example.com
KUBEDECK_ADMIN_PASSWORD=$(openssl rand -base64 18)
KUBEDECK_DATABASE_URL=sqlite:/data/kubedeck.db
EOF
chmod 600 kubedeck.env
```
::: /step

::: step "Prepare a data folder"
The database lives in `/data`. The container runs as uid 1000, so that user must be able to write the folder you mount there.

```bash
mkdir -p kubedeck-data
```
::: /step

::: step "Start the container"
```bash
docker run -d --name kubedeck -p 5000:5000 \
  --env-file kubedeck.env \
  -v "$PWD/kubedeck-data:/data" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  swapnilsaal/kubedeck:2.0.0-web

docker logs kubedeck
```

`--read-only` and `--tmpfs /tmp` keep the image unchanged and put the decrypted kubeconfigs `kubectl` reads in memory only.

The log shows `database: sqlite /data/kubedeck.db` and, on the first start, `Created the first admin, admin@example.com.`
::: /step

::: step "Sign in"
Open `http://localhost:5000`. Sign in with `KUBEDECK_ADMIN_EMAIL` and the password from `kubedeck.env`.
::: /step
::: step "Add clusters, groups and people"
In **Settings → Clusters**, add each cluster with a kubeconfig for KubeDeck. Then create groups with service accounts on those clusters in **Settings → Groups**, and add people, yourself included, in **Settings → Users**. See [Clusters](/web/clusters).
::: /step
::: /steps

::: callout warning title:"Uploaded kubeconfigs run inside the container"
KubeDeck runs `kubectl` in the container, so each cluster's API server address must be reachable from there. `127.0.0.1` or `localhost` points at the container. Only a token or an inline client certificate is accepted, never a program that signs in, such as a cloud provider's CLI. **This cluster** is not offered: KubeDeck is not in a pod.
:::

The hostname people open must match `KUBEDECK_PUBLIC_URL`. A request for any other hostname gets `403 Forbidden: KubeDeck only accepts requests from its own window.` See [Configuration](/web/configuration) for `KUBEDECK_PUBLIC_HOSTS`.

## Behind a proxy

Put TLS in front of the container and set `KUBEDECK_PUBLIC_URL` to the `https://` address. Session cookies are then marked secure. Set `KUBEDECK_PROXY_HOPS` to the number of proxies you run in front, so the sign-in rate limit and the audit log see each person's address.

Log streams are long-lived responses. Turn off response buffering on the proxy and give it a long read timeout.

## Build the image yourself

From a checkout of the repository:

```bash
script/docker-build.sh          # this machine's platform: swapnilsaal/kubedeck:<version>-web
script/docker-build.sh --push   # linux/amd64 + linux/arm64, pushed as one tag (needs docker login)
```

`script/docker-build.sh` without `--push` also removes older `swapnilsaal/kubedeck` images afterwards. For your own registry:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t registry.example.com/kubedeck:<version>-web --push .
```

The `<version>` is the `version` in `package.json`.
