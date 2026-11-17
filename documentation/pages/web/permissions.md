---
title: "Permissions"
description: "Understand the two permission layers of web mode, KubeDeck permissions and Kubernetes RBAC, and how they combine."
---

# Permissions

What someone may do in web mode is decided in two layers. **KubeDeck permissions** decide which KubeDeck features a person may use, such as the palette or the assistant. **Kubernetes permissions** decide what the service accounts they act as may do in a cluster. KubeDeck permissions are set per group in KubeDeck; Kubernetes permissions are the cluster's own Roles and bindings. The server's own switches sit above both.

## The layers at a glance

| Layer | Set where | Decides | Enforced by |
|---|---|---|---|
| Server switches | Environment: `KUBEDECK_READ_ONLY`, `KUBEDECK_AI`, `KUBEDECK_POD_FILES` | Whether a feature exists on this KubeDeck at all | The KubeDeck server |
| KubeDeck permissions | **Settings → Groups → Edit** | Which features a person may use | The KubeDeck server, and hidden in the browser |
| Kubernetes permissions | Roles and bindings for each group's service account, on the cluster (**Settings → Groups → RBAC** opens them) | What the service account may read and change in a cluster | The Kubernetes API server |

A feature works only when all three allow it. Before any of them, the person needs a group with a service account on the cluster: without one, they have no access there at all. See [Groups and cluster access](/web/groups).

## KubeDeck permissions

Each group has six switches. A person gets a feature when **any** of their groups allows it. An admin always has all of them. Someone in no group has none.

| Switch | What it allows | Refused with |
|---|---|---|
| **Ask Deck (assistant)** | Chat with the assistant; explain and diagnose. Covers every assistant request. | `Your KubeDeck groups do not include Ask Deck (assistant). Ask a KubeDeck admin.` |
| **Assistant may propose changes** | The assistant may run commands that change the cluster, after you approve them. Off: it only reads, whatever the cluster allows. | `Blocked: your KubeDeck groups let the assistant read only.` |
| **kubectl palette** | Run kubectl commands from the palette. | `Your KubeDeck groups do not include kubectl palette. Ask a KubeDeck admin.` |
| **Pod files** | Browse and download files inside containers. | `Your KubeDeck groups do not include Pod files. Ask a KubeDeck admin.` |
| **Create and edit projects** | Create projects, and change your own. Off: projects are view only. | `Your KubeDeck groups do not include Create and edit projects. Ask a KubeDeck admin.` |
| **MCP server tools** | The assistant may call tools from MCP servers. | The assistant is not offered those tools. |

A new group starts with every switch on. A switch added in a later version also starts on for existing groups.

The server refuses requests the person's groups do not allow, so hiding a button is not the only guard. The browser also hides what is off.

An MCP server can also be limited to some groups. See [MCP servers](/integrations/mcp-servers).

## Kubernetes permissions

The cluster decides what each service account may do, through its own Roles, ClusterRoles and their bindings. KubeDeck does not keep a copy of these and does not change them: a cluster admin manages them, with `kubectl` or with KubeDeck's resource pages.

In **Settings → Groups**, select a group and open **RBAC** on one of its clusters. It switches to that cluster and opens:

- the group's **service account**,
- **Role bindings** and **Roles** in the service account's namespace,
- **Role bindings** in all namespaces,
- **Cluster role bindings**.

What you can see and change there depends on your own access on that cluster, like anywhere else in KubeDeck. For example, a binding that gives a group's service account `edit` in one namespace:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: shop-editor-edit, namespace: shop }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: edit }
subjects: [{ kind: ServiceAccount, name: shop-editor, namespace: shop }]
```

To check what a service account may do, ask the cluster as that account:

```bash
kubectl auth can-i --list -n shop --as=system:serviceaccount:shop:shop-editor
```

## How they combine

| Feature | Server switch | KubeDeck permission | Kubernetes RBAC on a group's service account |
|---|---|---|---|
| Lists and details | always on | none needed | `get`, `list` on the kind |
| Scale, restart, edit, delete | off with `KUBEDECK_READ_ONLY=true` | none needed | the matching verbs |
| Logs | always on | none needed | `get pods/log` |
| kubectl palette | read commands only with `KUBEDECK_READ_ONLY=true` | **kubectl palette** | whatever the command needs |
| Ask Deck | off with `KUBEDECK_AI=off` | **Ask Deck (assistant)** | what each command it runs needs |
| Assistant changes | refused with `KUBEDECK_READ_ONLY=true` | **Assistant may propose changes** | the matching verbs |
| Pod files | off with `KUBEDECK_POD_FILES=off` | **Pod files** | `create pods/exec` |
| Projects | always on | **Create and edit projects**, to change them | none |
| Port-forward | never in web mode | none | none |

## Examples

Cluster `dev`, namespace `shop`. Developers acts as service account `shop/shop-editor`, bound to a Role that may view, read logs, and scale and restart in `shop`. Developers has **Assistant may propose changes** off. On-call acts as `ops/oncall`, which may also delete pods in `shop`.

| Person | Groups | Scale `shop/web` | Delete a pod in `shop` | Palette | Assistant |
|---|---|---|---|---|---|
| dana@example.com | Developers | Yes | No: `shop-editor` lacks `delete pods` | Yes | Reads only |
| sam@example.com | Developers, On-call | Yes | Yes: refused as `shop-editor`, then allowed as `ops/oncall` | Yes | Proposes changes: On-call allows it |
| lee@example.com | none, user | No: no group covers `dev` | Same | No | No |
| admin@example.com | none, admin | No: no group covers `dev`, admins included | Same | Yes, but no cluster to run it on | Proposes changes, but reads nothing from `dev` |
| Any of them | any, with `KUBEDECK_READ_ONLY=true` | No | No | Read commands only | Reads only |

## How the UI decides what to show

For buttons and the sidebar, KubeDeck asks the cluster which rules apply in the namespace (a SelfSubjectRulesReview, the API behind `kubectl auth can-i --list`). It asks once per identity the person has on that cluster and merges the answers. Answers are kept for a minute. With **All namespaces** selected, the `default` namespace stands in for cluster-wide rules.

This only shapes the screen. The API server still decides every request.
