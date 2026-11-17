---
title: "Clusters and namespaces"
description: "Choose the cluster and namespace every page shows, add kubeconfig files, and understand why some kinds are hidden."
---

# Clusters and namespaces

Every page in KubeDeck looks at one scope: a cluster (a kubeconfig context) and a namespace, or all namespaces. You set it once in the scope switcher and every list, the Overview and the map follow it. This page explains the switcher, where the clusters come from, and how your permissions shape what you see.

## The scope switcher

The scope switcher sits in the page header. It reads like `dev / shop`, with a coloured dot in front:

| Dot | Meaning |
|---|---|
| green | your account can read pods in this scope |
| amber, with a lock | it cannot: pick another namespace |
| grey | no cluster selected yet |

Click it to open two lists.

**Cluster.** On the desktop, every context in your kubeconfig files; the kubeconfig's current context is marked **kubeconfig default**. In web mode, only the clusters your groups give you, with no default. With more than six clusters, a **Find a cluster…** box appears.

**Namespace.** A **Find a namespace…** box, then **All namespaces**, then each namespace.

- Namespaces where your account may not list pods are dimmed, marked with a lock, and listed last.
- When KubeDeck could check, the header reads `N of M readable`.

Detail pages keep the scope of the resource they show, so the switcher is not shown there.

### What KubeDeck remembers

- The cluster and namespace you picked, in this browser (or this app), across restarts.
- The last namespace you used on each cluster. Switching clusters takes you back to it. The first visit to a cluster starts at **All namespaces**.

A link that carries `?context=…&namespace=…` sets the scope when you open it, for example a link someone copied from their KubeDeck.

## All namespaces

**All namespaces** shows every namespace at once. Lists gain a namespace column, and the Overview judges the whole cluster.

It needs permission to list pods across the cluster. If your account only has access to some namespaces, KubeDeck marks **All namespaces** with a lock. If that was your saved scope, the Overview moves you once per cluster to a namespace you can read, and tells you it did.

The [Map](/guide/map) is the exception: it always shows one namespace and asks you to pick one.

## Where clusters come from

::: tabs
::: tab "Desktop"
The desktop app reads `~/.kube/config` by default. To use more files, open **Settings → Clusters**.

- **Add custom kubeconfig path…**: type a path and press **Add**.
- **Scan for Kubeconfig Files**: finds `~/.kube/config` and the `.yaml`, `.yml` and `.conf` files in `~/.kube/`. It also finds the files in the `KUBECONFIG` variable KubeDeck was started with. Each result shows its contexts. Add the ones you want.
- Remove a file with the bin icon on its row. At least one path must stay.

KubeDeck merges the files the way `KUBECONFIG` does. Every context in them appears in the scope switcher. A listed file that no longer exists is marked **Not found** and skipped.
::: /tab
::: tab "Web"
In web mode, KubeDeck never reads a kubeconfig from the server's disk. An admin adds each cluster in **Settings → Clusters**, under **Administration**, with the connection KubeDeck uses for it. See [Clusters](/web/clusters).

A listed cluster gives nobody access. Your scope switcher shows only the clusters where one of your groups has a service account, admins included. On each of them, you act as those service accounts. See [Groups and cluster access](/web/groups).

With none, the switcher says `No clusters for you yet. A KubeDeck admin gives your groups access to clusters.`
::: /tab
::: /tabs

## The sidebar follows your permissions

The sidebar lists resource kinds in groups: Workloads, Network, Config, Storage, Access and Cluster. It shows only what you can use in the current scope:

- A kind your account may not `list` in this namespace is left out. Cluster-wide grants, such as nodes, are counted too.
- Add-on kinds appear only on clusters that serve them. The Gateway API kinds (Gateways, HTTP routes, gRPC routes) are the example today.

KubeDeck checks this once per scope and waits for the answer. The sidebar does not show every kind and then remove some.

The same rule applies to actions. A button for something your account may not do, such as **Delete pod…** or **Scale…**, is not shown at all.

::: callout tip
**All resources**, at the bottom of the sidebar, lists every kind the cluster serves, custom resources included.
:::

## Sidebar tips

- Fold a group by clicking its heading. **Access** starts folded. A folded group still shows the kind you are on.
- Press `⌘B` (`Ctrl+B` on Windows) to collapse the sidebar to icons, and again to expand it.
- The **Pods** and **Deployments** entries carry a badge: red with the number failing, or grey with the total when all is well.
