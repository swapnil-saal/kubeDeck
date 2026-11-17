---
title: "Overview page"
description: "Read the Overview: the health verdict, what needs attention, what changed lately and whether there is room."
---

# Overview page

The Overview is KubeDeck's home screen, at `/`. It answers one question for the cluster and namespace you picked: is anything wrong, and what should you look at first? Everything on it comes from the lists KubeDeck already polls, so it adds no extra load on the cluster.

## Header

The header shows the scope switcher (see [Clusters and namespaces](/guide/clusters-and-namespaces)) and three views of the same scope:

| View | What it shows |
|---|---|
| **Summary** | This page. |
| **Map** | The namespace as a graph. See [Map](/guide/map). |
| **Traces** | Per-service traces, only when the Tempo plugin is set up. See [Traces](/guide/traces). |

Next to them, **Live** means the lists refresh every 10 seconds. The refresh button re-reads every cluster list on screen now.

## The verdict

The top card gives a health score, one sentence and a summary line.

- **Score**: a ring from 0 to 100. It rises with the share of pods that are up and deployments that are ready, and drops for each critical problem.
- **Sentence**: **Everything is running**, **Running, with restarts to watch**, or how many things need attention.
- **Summary**: pods up, deployments ready, nodes ready, and restart-heavy pods.

When KubeDeck cannot read the pod list, there is no score. The card says **Health unknown** instead of looking healthy.

### Tiles

Five tiles sit next to the verdict. Each opens its list.

| Tile | Value | Opens |
|---|---|---|
| **Pods** | pods up out of all pods | the pod list, filtered to **Only unhealthy pods** when some are failing |
| **Deployments** | ready out of all | the deployment list, filtered to unhealthy ones when some are not ready |
| **Services** | how many, plus ingresses | the service list |
| **Nodes** | ready out of all, with the average node CPU underneath when metrics are available | the node list |
| **Restarts** | total restarts in scope | the pod list filtered to **Pods with 5+ restarts** |

A tile that could not be read says so: forbidden, offline or error.

### Ask about this scope

When the assistant is on, an **Ask about…** box sits under the verdict. Up to three suggested questions sit next to it, built from what is failing now, plus **Find hidden risks**. See [Ask Deck](/guide/assistant).

### Pinned and recent

Below the verdict are chips for the resources you pinned and the last ones you opened in this cluster. Pin a pod or deployment from its row menu (**Pin**). Click a chip to open it.

## Needs attention

This panel lists what is broken now, worst first:

| Finding | Severity |
|---|---|
| Pod crashing (`CrashLoopBackOff`, `Error`, `OOMKilled`, `CreateContainerConfigError` and similar) | critical |
| Pod that cannot pull its image (`ImagePullBackOff`, `ErrImagePull`, `InvalidImageName`) | critical |
| Pod `Failed`, `Unknown`, `Evicted` or `NodeLost` | critical |
| Node that is not `Ready` | critical |
| Deployment with no ready replicas | critical |
| Deployment with some replicas missing | warning |
| Pod stuck `Pending`, `ContainerCreating` or in an init container | warning |
| Pod running with some containers not ready | warning |
| Failed job | warning |
| Volume claim that is not bound | warning |

The first eight are shown, with a count of the rest. Each row has:

- The name: click it to open the resource.
- **Logs**, on pod rows.
- **Diagnose**, which hands the assistant the resource and the right question.

With more than one problem, **Diagnose all** asks the assistant to triage them together.

Under the list, **Restarting often** shows pods that are running but have restarted 5 times or more. **Why?** asks the assistant about one of them.

When nothing is failing, the panel says so: every pod is up and every deployment has its replicas.

## Activity

The **Activity** panel is a timeline of what changed and what complained, newest first. Filter it with **All**, **Changes** or **Warnings**.

- **Rolled out**: a workload whose pods were created in the last 7 days. KubeDeck reads this from pod creation times, because Kubernetes keeps events for a short time only.
- **Scaled** and **stopped**: from the scaling and container-kill events of the last hour.
- **Warnings**: warning events from the last hour, grouped per reason and object, with a count.

Click an entry to ask the assistant about it.

## Capacity

The **Capacity** panel tells you whether there is room.

- **CPU and memory**: what the pods in scope use against what they request. KubeDeck notes when pods use more than they request, or under a quarter of it.
- **Nodes · fullest first**: the five fullest nodes, by CPU or memory, whichever is higher.
- **Busiest pods right now**: the pods using the most CPU. Without live metrics this becomes **Largest requests**.

Live usage needs metrics-server on the cluster and permission to read `metrics.k8s.io`. Without either, the panel shows requests only and says why.

## When the scope cannot be read

- **No permission**: if your account cannot list pods in the namespace you picked, the Overview says so and offers the namespaces you can open. If the scope you saved is not readable, KubeDeck moves you once per cluster to one you can read, and tells you.
- **Cluster unreachable**: if the API server does not answer (VPN off, cluster down), the Overview says nothing could be checked. It offers **Try again** and buttons for your other clusters.

## Web mode

The Overview is the same in both modes. In web mode it shows what your own access allows. When the assistant is off for you, the ask box and the **Diagnose** buttons are hidden, and a finding opens the resource instead.
