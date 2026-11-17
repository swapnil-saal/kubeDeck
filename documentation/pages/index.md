---
title: "KubeDeck"
description: "KubeDeck is a Kubernetes dashboard for your desktop or for your whole team: browse clusters, read logs, run kubectl, and ask an AI assistant what is wrong."
---

# KubeDeck

KubeDeck is a Kubernetes dashboard that runs two ways. As a **desktop app** it uses your own kubeconfig and needs nothing else. As a **shared web service** it signs your team in, gives each group its own service account on each cluster, and records every change in an audit log.

It talks to clusters through `kubectl`, so it works with any cluster you can already reach, and the cluster's own RBAC always has the last word.

::: grids
    ::: grid
        ::: card title:"Install the desktop app" icon:monitor
        macOS and Windows builds, using the kubeconfig you already have.

        [Installation](/getting-started/installation)
        ::: /card
    ::: /grid

    ::: grid
        ::: card title:"Run it for your team" icon:server
        One container, sign-in built in, groups with their own service accounts.

        [Shared web mode](/web/overview)
        ::: /card
    ::: /grid

    ::: grid
        ::: card title:"Find what is broken" icon:activity
        Crashing pods, failed rollouts and NotReady nodes on one page.

        [Overview page](/guide/overview)
        ::: /card
    ::: /grid
::: /grids

## What you can do with it

| Area | What KubeDeck gives you |
| --- | --- |
| Clusters | On the desktop, every context in your kubeconfigs; in web mode, the clusters an admin added that your groups give you. One cluster and namespace at a time, or all namespaces |
| Resources | Lists and detail pages for workloads, networking, config, storage and cluster kinds, with YAML, events and actions such as scale, restart and delete |
| Logs | Live logs of a pod or a whole workload, and log history from Grafana Loki |
| Map | How a namespace's resources connect |
| Projects | One application across several namespaces and clusters, with its health and a comparison of environments |
| kubectl palette | Run `kubectl`, or describe what you want in plain words (⌘K) |
| Ask Deck | An AI assistant that reads the cluster for you and asks before changing anything |
| Traces | Endpoints, errors and latency from Grafana Tempo, next to the workload |
| Teams | Clusters an admin adds, accounts, groups, per-cluster service accounts, KubeDeck permissions and an audit log in web mode |

## Desktop or web

| | Desktop | Shared web mode |
| --- | --- | --- |
| Who uses it | You, on your machine | Your team, in the browser |
| Clusters | The contexts in your kubeconfig files | Added by an admin in **Settings → Clusters**. The server's own kubeconfig is never read |
| Cluster identity | Your kubeconfig | The service accounts your groups have on that cluster. No group there, no access |
| Sign-in | None | KubeDeck's own accounts, created by an admin |
| Settings | Edited in the app | Environment variables, plus admin pages for clusters, users, groups and plugins |
| Port-forward | Yes | No (the port would open on the server) |

Start with [Installation](/getting-started/installation), or read [Desktop vs web](/web/overview) to choose.

::: callout tip title:"These docs inside KubeDeck"
Every KubeDeck serves this documentation at `/docs`, so your team can read it on the same address they use KubeDeck.
:::
