---
title: "Grafana Tempo"
description: "Connect KubeDeck to Grafana Tempo so workloads get a Traces tab, Overview gets per-service health, and the assistant can read traces."
---

# Grafana Tempo

The **Tempo traces** plugin connects KubeDeck to Grafana Tempo's HTTP API. With it, each workload gets a **Traces** tab with its endpoints, errors and latency, **Overview → Traces** shows per-service health for a namespace, and the assistant can search and read traces. KubeDeck only sends GET requests: it cannot change anything in Tempo.

For what you see on screen, read [Traces](/guide/traces). This page is about setting it up.

## What Tempo must have

KubeDeck finds traces by the OpenTelemetry resource attributes that the OTel operator or collector puts on every span. Your spans need:

| Attribute | Used for |
| --- | --- |
| `k8s.cluster.name` | Which cluster a span came from |
| `k8s.namespace.name` | The namespace |
| `k8s.deployment.name`, `k8s.statefulset.name`, `k8s.daemonset.name`, `k8s.replicaset.name`, `k8s.job.name`, `k8s.cronjob.name`, `k8s.pod.name` | The workload or pod |
| `service.name` | A Service's traces, and grouping by service |

Without `k8s.cluster.name`, KubeDeck cannot tell which spans belong to the cluster on screen.

## Configure it

You can configure the plugin in **Settings → Plugins → Tempo traces**, or from the server's environment. A variable that is set wins and shows read-only on the page.

| Field | Variable | Meaning |
| --- | --- | --- |
| **Tempo URL** (required) | `KUBEDECK_TEMPO_URL` | Tempo's HTTP API, e.g. `https://tempo.example.com` |
| **Token** | `KUBEDECK_TEMPO_TOKEN` | Sent as `Authorization: Bearer <token>` when Tempo needs one. Stored encrypted |
| **Tenant** | `KUBEDECK_TEMPO_TENANT` | Sent as `X-Scope-OrgID`, for a multi-tenant Tempo |
| **Clusters** | `KUBEDECK_TEMPO_CLUSTERS` | Kube context → the `k8s.cluster.name` its traces carry, where KubeDeck cannot tell |
| **Grafana URL** | `KUBEDECK_GRAFANA_URL` | Your Grafana, for **Open in Grafana** on a trace |
| **Grafana Tempo data source** | `KUBEDECK_GRAFANA_TEMPO_DATASOURCE` | The uid of the Tempo data source in Grafana, for the same link |

The plugin is on by default when it has a URL. The URLs must start with `http://` or `https://`; otherwise the plugin shows as unconfigured.

```yaml
env:
  - { name: KUBEDECK_TEMPO_URL, value: "https://tempo.example.com" }
  - { name: KUBEDECK_TEMPO_TENANT, value: "prod" }
  - { name: KUBEDECK_TEMPO_CLUSTERS, value: "production=prod" }
  - { name: KUBEDECK_GRAFANA_URL, value: "https://grafana.example.com" }
  - { name: KUBEDECK_GRAFANA_TEMPO_DATASOURCE, value: "tempo" }
```

**Test connection** asks Tempo for the values of `k8s.cluster.name` over the last 24 hours. On success the card shows how many clusters it found, for example "3 clusters".

### The Clusters map

`KUBEDECK_TEMPO_CLUSTERS` is a comma list of `context=cluster` pairs:

```bash
KUBEDECK_TEMPO_CLUSTERS="dev-admin=dev,staging-admin=staging,production=prod"
```

KubeDeck matches a kube context to a Tempo cluster in this order:

1. The Clusters map.
2. A Tempo cluster with the same name as the context.
3. A Tempo cluster with the same name as the context's cluster entry in the kubeconfig.
4. The only cluster, when Tempo knows just one.
5. The one cluster whose traces carry the namespace on screen (over the last 24 hours).

When none of these finds exactly one cluster, the Traces page asks you to map the context under Tempo traces in Settings → Plugins.

::: callout tip title:"Web mode"
In web mode, a context is the name an admin gave the cluster in **Settings → Clusters**. Name it like the cluster's `k8s.cluster.name` in Tempo and no map is needed. Otherwise map it, for example `production=prod`.
:::

The Loki logs plugin uses the same map to find a context's `cluster` label. See [Grafana Loki](/integrations/loki).

## What it adds

| Where | What |
| --- | --- |
| Workload **Traces** tab | Endpoints with requests, error % and p95, a rollout check on Deployments, and each trace in a side panel |
| **Overview → Traces** | The same per service, for the namespace |
| Trace view | The span waterfall; with the Loki logs plugin on, the pod's log lines at that moment |
| **Open in Grafana** | Opens the trace in Grafana Explore, when the Grafana URL and data source are both set |
| Assistant | `traces_stats`, `traces_search` and `trace_get` |

Tempo answers metrics queries for at most 3 hours by default. When a longer window is refused, KubeDeck measures over the window Tempo allows and says so.

## Who sees which traces

On the desktop, you see whatever your Tempo returns.

In web mode, traces can carry URLs, ids and parts of payloads, so KubeDeck checks access per namespace:

- A namespace's traces are shown only to someone who may `list pods` there. KubeDeck checks with `kubectl auth can-i list pods`, as that person.
- A trace that crosses namespaces loses the spans from namespaces the person cannot read.
- Without a namespace picked, the person needs `list pods` in every namespace.

## Troubleshooting

| Message | What to do |
| --- | --- |
| "Tracing is not set up." | Switch on Tempo traces in Settings → Plugins, or set `KUBEDECK_TEMPO_URL` |
| "Which Tempo cluster is …?" | Add the context to the Clusters map |
| "Cannot reach Tempo at …" | The KubeDeck server cannot reach the URL. Check DNS, network policy and the URL |
| "Tempo sent something that is not JSON." | The URL does not point at Tempo's HTTP API |
| "Tempo did not answer within 25 seconds." | Try a shorter time range |
| "You cannot list pods in …, so its traces are hidden." | Web mode: the person needs `list pods` in that namespace |

## Related

- [Traces](/guide/traces)
- [Grafana Loki](/integrations/loki)
- [Plugins](/integrations/plugins)
- [Environment variables](/reference/environment-variables)
