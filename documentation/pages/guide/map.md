---
title: "Map"
description: "See one namespace as a graph of routes, services, workloads and the config and storage they use, and follow how they connect."
---

# Map

The map draws one namespace as a graph: what routes traffic to what, what runs, and what it reads. Use it to see how an application is wired, or to find the broken link in the chain. Examples are a service that selects no pods, or an ingress that points at a missing service.

## Open the map

On the Overview, switch the header from **Summary** to **Map**. The map uses the cluster and namespace in the scope switcher.

The map shows one namespace at a time. With **All namespaces** selected, it asks you to pick one from a list.

## How it is laid out

Four columns, left to right:

| Column | Holds |
|---|---|
| **Ingress & routes** | Ingresses, and Gateway API HTTP and gRPC routes on clusters that serve them |
| **Services** | Services, linked to the workloads whose pods they select |
| **Workloads** | Deployments, StatefulSets, DaemonSets, CronJobs, Jobs, and pods no controller owns |
| **Config & storage** | ConfigMaps, Secrets and volume claims the workloads use |

Pods are folded into the workload that owns them. A Deployment's pods (through its ReplicaSet) appear as the Deployment, and a CronJob's pods (through its Jobs) as the CronJob. A namespace with hundreds of pods reads as its workloads.

ConfigMaps and Secrets come only from the references in pod specs: volumes, `env` and `envFrom`. KubeDeck never reads their contents to draw the map.

## What each card tells you

Each card shows a coloured dot and one line of detail:

| Dot | Meaning |
|---|---|
| green | healthy: every wanted replica is ready |
| amber | something to check |
| red | broken |
| grey | neutral, such as a ConfigMap or a CronJob |

The detail line depends on the kind:

- **Workloads**: `ready/wanted ready`, plus how many pods are failing. A CronJob shows its schedule. A workload with an autoscaler shows **autoscales min–max**.
- **Services**: their type and ports. **selects no pods** (amber) when the selector matches nothing. Workloads scaled to zero still count, through their pod template.
- **Ingresses and routes**: their hosts. A route also names its gateways. A route the gateway did not accept is red (**not accepted by its gateway**). One whose backends did not resolve is amber (**backends not resolved**).
- **Missing services**: a service an ingress or route points at that does not exist appears red, marked **does not exist**.
- **Volume claims**: their phase and size. Not bound is amber; missing is red.

Only Services in the same namespace are drawn for a route's backends.

## Find your way

- **Find a resource…** matches names and kinds. The map keeps the matches and everything connected to them.
- **Problems** keeps only amber and red cards, with their chains. The button shows how many there are.
- **Config & storage** hides or shows the last column.
- **Click** a card to follow its connections. Everything outside its chain fades. Click it again, or the background, to stop.
- **Double-click** a card, or use its arrow button, to open the resource.

With the keyboard, `Enter` opens the focused card and `Space` follows its connections.

The search and the two toggles are kept in the page's URL.

## Permissions

KubeDeck reads the namespace with a single `kubectl get` that covers every kind it draws. A kind your account may not list is left out. Above the graph, the map then says **Not shown (no permission to read)** and names the kinds. If it can read nothing at all, the map shows the cluster's error instead.

## Maps in projects

A [project](/guide/projects) has its own **Map** tab. It shows the same map for each namespace in the project, with a button per place to switch between them.
