---
title: "Clusters"
description: "Add the clusters a shared KubeDeck can reach, give KubeDeck a working connection to each, and reconnect or remove them."
---

# Clusters

A shared KubeDeck reaches only the clusters an admin adds in **Settings → Clusters**. Each cluster has a name and a connection: the credentials KubeDeck itself uses for that cluster. Listing a cluster gives nobody access. People reach it only through a [group](/web/groups) that has a service account on it.

::: callout info title:"Web mode only"
Web mode never reads a kubeconfig from the server's disk. At start it points `KUBECONFIG` at an empty file, so these clusters are the only ones it knows. The desktop app is different: its **Settings → Clusters** lists the kubeconfig files it reads. See [Clusters and namespaces](/guide/clusters-and-namespaces).
:::

## Setup order

::: steps
::: step "Add the clusters"
Here, in **Settings → Clusters**.
::: /step
::: step "Create groups with service accounts on them"
In **Settings → Groups**, give each group one service account on each cluster it should reach. See [Groups and cluster access](/web/groups).
::: /step
::: step "Add people to groups"
In **Settings → Users**. See [Users and roles](/web/users).
::: /step
::: /steps

This applies to admins too. An admin manages clusters, but sees a cluster in the scope switcher only when one of their own groups has a service account on it.

## What the connection is for

KubeDeck uses a cluster's connection for three things:

- To **impersonate the service accounts groups pick**. A person's call runs as `kubectl --kubeconfig=<the cluster's connection> --as=system:serviceaccount:<namespace>:<name>`.
- To **list namespaces and service accounts** in the group form.
- To **check whether it may impersonate** the service account you pick.

A person's call never runs as the connection itself. A group that has an uploaded kubeconfig on a cluster runs with that kubeconfig there, not with the connection.

## Add a cluster

::: steps
::: step "Open Settings → Clusters"
Only admins see it, under **Administration**. Choose **Add cluster**.
::: /step
::: step "Name it"
The **Name** is how people see the cluster in the scope switcher, for example `prod`. It must be unique, and it cannot start with `-`. Letters, digits and `. _ : @ / + = -` are allowed, up to 253 characters. There is no rename: to change a name, add the cluster again under the new one.
::: /step
::: step "Choose the connection"
**Upload kubeconfig**: drop a file, choose one, or paste it. **This cluster** appears only when KubeDeck runs in a pod, and uses the pod's own service account.
::: /step
::: step "Add it"
Choose **Add cluster**. KubeDeck checks the connection with `kubectl auth whoami` before it saves.
::: /step
::: /steps

## Upload a kubeconfig

KubeDeck accepts only credentials that cannot run anything on the server: a token, or a client certificate and key inline (`client-certificate-data`, `client-key-data`). It refuses a kubeconfig whose user has:

- an exec plugin, or an auth provider,
- a token file, or a client certificate or key given as file paths,
- a username and password,
- impersonation (`as`, `as-groups`, `as-uid`, `as-user-extra`).

It also refuses a cluster entry with a `certificate-authority` file path (use `certificate-authority-data`) or a `proxy-url`.

When the file has one context, KubeDeck uses it. With several, it uses the one named like the cluster, else the file's `current-context`. It keeps only that context's server, CA data, `insecure-skip-tls-verify`, `tls-server-name`, namespace, and token or certificate.

On save, `kubectl auth whoami` runs with the new credentials:

- If the cluster refuses them, the save fails: `The cluster refused these credentials (the token may be expired or revoked).`
- If the cluster cannot say who they are, for example because it is unreachable, the save still goes through. The row then says **signs in as unknown**.

The kubeconfig is stored encrypted (AES-256-GCM, with a key derived from `KUBEDECK_AUTH_SECRET`) and is never shown again. While KubeDeck runs, it is decrypted into a private temporary folder that only KubeDeck's user can read.

### A token kubeconfig for KubeDeck

A service account token is the simplest connection. For example, a service account `kubedeck-connection` in the namespace `kubedeck` of the cluster you add:

```bash
kubectl create serviceaccount kubedeck-connection -n kubedeck
kubectl create token kubedeck-connection -n kubedeck --duration=720h
```

The API server may cap the duration. Put the token and the cluster's address and CA into a kubeconfig with one context:

```yaml
apiVersion: v1
kind: Config
clusters:
  - name: prod
    cluster:
      server: https://prod.example.com:6443
      certificate-authority-data: <base64 CA certificate>
users:
  - name: kubedeck-connection
    user:
      token: <the token>
contexts:
  - name: prod
    context: { cluster: prod, user: kubedeck-connection }
current-context: prod
```

When the token expires, [reconnect](#clusters-reconnect-a-cluster) the cluster with a new one. Then give that service account the RBAC below.

::: callout warning title:"The server address is used from KubeDeck"
KubeDeck runs `kubectl` from its own container or pod. A server address of `127.0.0.1` or `localhost` points at that container, not at your machine.
:::

## This cluster

When KubeDeck runs in a pod, **Add cluster** offers **This cluster**. It uses the service account of KubeDeck's own pod for the cluster KubeDeck runs in. With the bundled manifest, that is `kubedeck` in the namespace `kubedeck`.

- Nothing is uploaded or stored. The token is read from the pod's token file on each use, so token rotation needs no restart.
- The row shows **KubeDeck's own pod service account** in place of a server address.
- KubeDeck never uses its pod's service account on its own. Only a cluster added this way does.

## What the connection needs

Give the connection's identity (the uploaded kubeconfig's user, or KubeDeck's pod service account) only what you use:

| To | RBAC on the connection's identity |
|---|---|
| Let groups use a service account picked from the cluster | `impersonate` on `serviceaccounts`, best with `resourceNames` naming each one |
| List namespaces in the group form | `list` on `namespaces`. Without it, you type the namespace |
| List a namespace's service accounts in the group form | `list` on `serviceaccounts` in that namespace. Without it, you type the name |

A Role that lets the connection impersonate two service accounts in `shop`, bound to KubeDeck's pod service account:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: kubedeck-impersonate, namespace: shop }
rules:
  - apiGroups: [""]
    resources: [serviceaccounts]
    resourceNames: [shop-editor, shop-viewer]
    verbs: [impersonate]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: kubedeck-impersonate, namespace: shop }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: kubedeck-impersonate }
subjects:
  - { kind: ServiceAccount, name: kubedeck, namespace: kubedeck }
```

For an uploaded kubeconfig, bind its own identity instead, for example the service account `kubedeck-connection`.

Where the connection may not impersonate, a group can upload a kubeconfig for its service account instead. See [Groups and cluster access](/web/groups).

## The list

Each row shows:

- the cluster's name, and its API server (or **KubeDeck's own pod service account**),
- **signs in as** and the identity `kubectl auth whoami` reported at save, shortened to `namespace/name` for a service account,
- **used by** and the groups that have a service account on it, or **no group yet**.

## Reconnect a cluster

Use this when the connection's token expired or its certificate was rotated. Open the row's menu and choose **Upload a new kubeconfig**. The same checks run as when you added it. Groups keep their service accounts on the cluster.

A cluster added as **This cluster** has nothing to upload, so it has no such option.

## Remove a cluster

Open the row's menu and choose **Remove cluster**. Nothing in the cluster changes. KubeDeck refuses while a group still has a service account on it:

```text
Developers still uses prod. Remove it from that group first.
```

Take the cluster out of those groups in **Settings → Groups**, then remove it.

## When a connection cannot be read

At start, KubeDeck writes each connection to a private file. If it cannot, the log says:

| Message | Cause and fix |
|---|---|
| `Cluster <name>: its connection cannot be read (was KUBEDECK_AUTH_SECRET changed?). Add it again.` | The secret changed, so the stored kubeconfig cannot be decrypted. Choose **Upload a new kubeconfig** on the cluster's row. |
| `Cluster <name>: its connection cannot be read (not running in that cluster). Add it again.` | A **This cluster** connection, but KubeDeck no longer runs in a pod. |

Until then, every call to that cluster fails.

## Related

- [Groups and cluster access](/web/groups)
- [Permissions](/web/permissions)
- [Security model](/web/security)
- [Deploy on Kubernetes](/web/deploy-kubernetes)
