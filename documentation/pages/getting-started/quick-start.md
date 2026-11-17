---
title: "Quick start (desktop)"
description: "Connect the desktop app to your clusters, find a failing pod, read its logs and ask the assistant about it."
---

# Quick start (desktop)

This walk-through takes you from a fresh install to a diagnosed pod. It uses the desktop app, which acts with your own kubeconfig credentials. You need KubeDeck installed and `kubectl` on your `PATH` (see [Installation](/getting-started/installation)).

::: steps
::: step "Open KubeDeck"
Start the app. It reads the contexts in `~/.kube/config` and opens the **Overview** for the kubeconfig's current context. In the cluster list that context is marked **kubeconfig default**.

If no context can be read, the Overview says **Could not load cluster contexts** and shows kubectl's error. Fix the kubeconfig, or add another one in the next step, then press **Retry**.
::: /step
::: step "Add your other kubeconfig files"
Open **Settings → Clusters**. The **Kubeconfig files** card lists the files KubeDeck reads. It merges them the way `KUBECONFIG` does, so every context in every file appears in the scope switcher.

- Type a path and press **Add**.
- Or press **Scan for Kubeconfig Files**. It looks at `~/.kube/config`, the `.yaml`, `.yml` and `.conf` files in `~/.kube/`, and the files in the `KUBECONFIG` variable KubeDeck was started with. Each result lists its contexts; add the ones you want.

A file that no longer exists is marked **Not found**. At least one path must stay in the list.
::: /step
::: step "Pick a cluster and a namespace"
Click the scope switcher in the header. It shows the cluster and namespace you are looking at, for example `dev / shop`.

Pick a cluster at the top and a namespace below it, or **All namespaces**. Namespaces your account cannot read are dimmed, marked with a lock and listed last. Every page follows this choice. More in [Clusters and namespaces](/guide/clusters-and-namespaces).
::: /step
::: step "Find a failing pod"
The Overview starts with a verdict, such as **2 things need attention**, and five tiles: Pods, Deployments, Services, Nodes and Restarts.

Look at **Needs attention**. It lists crashing pods, image-pull errors, pods stuck pending, deployments missing replicas, failed jobs, unbound volume claims and nodes that are not ready. Click a row to open that resource.

You can also click the **Pods** tile. When pods are failing it opens the pod list filtered to **Only unhealthy pods**.
::: /step
::: step "Read its logs"
In **Needs attention**, a pod row has a **Logs** button. In the pod list, **Logs** is the first button on each row.

The logs open live. For a pod in `CrashLoopBackOff`, press **Previous** to read the crashed container's output instead of the new one. Type `level:error` in the filter box to keep only error lines. See [Logs](/guide/logs) for the rest.
::: /step
::: step "Ask the assistant"
The assistant needs a model provider first. Set one in **Settings → AI assistant** (see [AI providers](/integrations/ai-providers)).

Then use any of these:

- **Diagnose** on a row in **Needs attention**, or **Diagnose all** when there are several problems.
- **Diagnose with AI** in a pod's row menu, or on a resource's page.
- The **Ask about…** box under the Overview's verdict.
- **Ask Deck** in the sidebar, for an open conversation.

The assistant reads the cluster with your credentials and asks before it runs anything that changes it. See [Ask Deck](/guide/assistant).
::: /step
::: /steps

## Where to go next

::: card title:"Resources and actions" icon:layers
Lists, detail pages, scaling, restarts and YAML edits: [Resources and actions](/guide/resources).
::: /card

::: card title:"kubectl palette" icon:square-terminal
Press `⌘K` (`Ctrl+K` on Windows) to run kubectl or describe what you want: [kubectl palette](/guide/kubectl-palette).
::: /card

::: card title:"Projects" icon:folder-kanban
Group one application's namespaces across clusters: [Projects](/guide/projects).
::: /card
