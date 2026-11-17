---
title: "Resources and actions"
description: "Browse resource lists, open a resource's detail page, and scale, restart, delete, drain or edit from the UI."
---

# Resources and actions

KubeDeck lists every resource kind in the scope you picked, and opens any resource on its own page with its description, YAML, events and logs. From there you can make the common changes, such as scaling or restarting a deployment, without typing kubectl. Each change runs as `kubectl` with your identity, so Kubernetes RBAC still decides what goes through.

## Resource kinds in the sidebar

The sidebar groups the kinds the way Kubernetes users think about them:

| Group | Kinds |
|---|---|
| Workloads | Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Autoscalers (HPA), ReplicaSets, Disruption budgets |
| Network | Services, Ingresses, Gateways, HTTP routes, gRPC routes, Network policies |
| Config | ConfigMaps, Secrets, Resource quotas, Limit ranges |
| Storage | Volume claims, Volumes, Storage classes |
| Access | Service accounts, Roles, Role bindings, Cluster roles, Cluster role bindings |
| Cluster | Nodes, Namespaces, Events, Custom resource definitions |

The Gateway API kinds appear only on clusters that serve them. Kinds you may not list in the current namespace are hidden (see [Clusters and namespaces](/guide/clusters-and-namespaces)).

**All resources**, at the bottom of the sidebar, lists every kind the cluster serves, custom resources included. Search it by name, kind, group or short name, and open any kind as a list.

## Lists

A list shows one kind in the current scope. The heading names the cluster and the scope (`all namespaces`, a namespace, or `whole cluster` for cluster-scoped kinds). Lists refresh every 10 seconds.

- **Filter**: the box above the table matches resource names. It is kept in the page's URL.
- **Sort**: click a column heading. Click again to reverse, a third time to clear. KubeDeck remembers the sort per table in this browser.
- **Columns**: show or hide columns from the columns menu. Some columns, such as a pod's image, IP and node, start hidden. The choice is remembered per table.
- **Namespace column**: shown only when you look at all namespaces.

If your account may not list the kind, the table says **Access denied** with the cluster's message.

### Pods

- **Status** sorts failing pods first, then pending, then running, then finished.
- **CPU** shows live usage when metrics are available, otherwise the CPU request (the heading then reads **CPU req**).
- Two quick filters arrive from the Overview: **Only unhealthy pods** and **Pods with 5+ restarts**. Click the chip to clear them.
- **List** / **By workload** switches between a flat list and pods grouped under the workload that owns them, with restarts per workload.

### Deployments, nodes and other kinds

Deployments, nodes and the common kinds have their own columns. Any other kind, including custom resources, shows the columns `kubectl get` prints for it.

## Row actions

Each row has one labelled button and a menu with the rest. An action your account may not take is not shown.

| Kind | Actions |
|---|---|
| Pod | **Logs**, **Diagnose with AI**, **Browse files**, **Environment variables**, **Port forward…**, **Pin**, **Delete pod…** |
| Deployment | **Logs**, **Diagnose with AI**, **Scale…**, **Rolling restart…**, **Pin** |
| Workload group (pods **By workload**) | **Logs**, **Diagnose with AI**, **Scale…**, **Rolling restart…**, **Pin** |
| Node | **Cordon** or **Uncordon**, **Drain…** |

What each change does:

- **Scale…** asks for the replica count and runs `kubectl scale`.
- **Rolling restart…** asks first, then runs `kubectl rollout restart`. Pods are replaced one by one.
- **Delete pod…** asks first. The pod's controller, if it has one, starts a replacement.
- **Cordon** stops new pods from being scheduled on the node. Running pods stay.
- **Uncordon** allows scheduling on the node again.
- **Drain…** opens a dialog. KubeDeck cordons the node and evicts its pods; DaemonSet pods stay. It respects disruption budgets and waits up to five minutes for them. Two options widen it. One evicts pods that use `emptyDir` volumes, whose data is lost. The other evicts pods no controller manages; they are deleted and not recreated.

**Port forward…** is desktop only. **Diagnose with AI** needs the assistant. **Browse files** needs pod files to be on. See [Pod files and port-forward](/guide/pod-files-and-port-forward).

## Create from YAML

Lists where your account may create the kind have a **Create** button. It opens **Create from YAML**, pre-filled with a template for that kind. You can paste several documents at once.

- **Preview** runs a server-side dry run and shows the diff. Nothing changes.
- **Create** applies the YAML.

## Detail pages

Click a resource's name to open its page. The tabs depend on the kind and on what your account may do:

| Tab | Shows |
|---|---|
| **Describe** | `kubectl describe` output |
| **YAML** | the live object. With the assistant on, **Explain** asks it to walk through the YAML. |
| **Edit** | an editor for the YAML, only when you may `patch` this resource |
| **Logs** | pods, deployments, StatefulSets, DaemonSets, ReplicaSets, jobs and services. See [Logs](/guide/logs). |
| **Environment** | a pod's environment variables, read with `kubectl exec ... env`. Needs `exec`. |
| **Files** | a pod's file tree, when pod files are on and you may `exec` |
| **Events** | the events about this resource |
| **Traces** | for workloads, when the Tempo plugin is on. See [Traces](/guide/traces). |
| **Connected** | the services, deployments, pods and ingresses linked to this one by labels and selectors |

**Diagnose with AI**, next to the tabs, opens an AI review of this resource when the assistant is on.

### Edit and apply

On **Edit**, change the YAML, then:

1. **Preview changes** runs `kubectl apply --dry-run=server` and `kubectl diff`. You see the objects that would change and the diff. Nothing is written.
2. **Apply** runs `kubectl apply`. On success KubeDeck goes back to the **YAML** tab with the new object.

**Cancel** drops your edits.

### The command bar

At the bottom of a list or detail page, a bar shows ready-made kubectl commands for what you are looking at, with a copy button. A detail page offers describe, get as YAML or JSON, events, and commands for the kind, such as logs, rollout status, or cordon. Commands you may not run, such as delete, are left out.

## Read-only and web mode

In web mode, every change runs as you: your group's service account on that cluster, or your own identity through impersonation. Buttons follow your RBAC, and the cluster refuses anything else. See [Groups and cluster access](/web/groups).

An administrator can start a shared KubeDeck with `KUBEDECK_READ_ONLY=true`. Then:

- **Scale…**, **Rolling restart…**, **Delete pod…**, **Cordon**, **Drain…**, **Edit** and **Create** are not shown.
- The server refuses every write to a cluster with "This KubeDeck is read-only".
- The kubectl palette and the assistant may only read.
- Projects can still be created and edited, because they do not touch a cluster.

Every change made through KubeDeck lands in the [audit log](/web/audit-log).
