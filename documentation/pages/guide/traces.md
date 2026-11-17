---
title: "Traces"
description: "See requests, errors and latency per service or endpoint from Grafana Tempo, open a trace as a span waterfall, and check whether a rollout made things worse."
---

# Traces

KubeDeck reads traces from Grafana Tempo and shows them next to the workloads that produced them. You see how many requests a service or endpoint handles, how many fail and how slow they are, and you can open any request as a span waterfall. Use it to find where a request fails or where the time goes, across services.

Traces appear once Tempo is connected. See [Grafana Tempo](/integrations/tempo) for the setup and how KubeDeck matches a kube context to a Tempo cluster.

## Where to find traces

| Where | What you see |
|---|---|
| **Overview → Traces** (the **Summary / Map / Traces** switch in the header) | Every service in the selected namespace |
| A workload's **Traces** tab | That workload's endpoints (span names) |
| `/trace/<id>` | One trace on its own page, to share or open from a log line |

The **Traces** tab appears on Deployments, StatefulSets, DaemonSets, ReplicaSets, Jobs, CronJobs, Pods and Services. A Service's traces are the ones whose `service.name` is the Service's name.

On the Overview Traces page, the **Trace id** box opens a trace by its id.

## Requests, errors and latency

The left table lists each service (or endpoint) with:

| Column | Meaning |
|---|---|
| **Req** | Rate of requests served and messages consumed (per second, minute or hour) |
| **Errors** | Share of those that failed |
| **p95** | 95th percentile duration. Click it to list requests at least that slow |

A line above the table sums up the whole scope. Pick a time range: **Last 15m**, **1h**, **6h** or **24h**. Tempo computes these numbers over a limited window. When the range you pick is longer, KubeDeck says which window it measured.

Click a row to narrow the trace list to that service or endpoint.

## Find traces

The right side lists matching traces, newest first. Choose:

- **Recent**: any request;
- **Failed**: requests with an error;
- **Slow**: requests at least as slow as the threshold shown.

Each row shows the span name, the calling service, when it happened and its duration. Failed requests are marked in red. Everything you pick is kept in the URL, so you can share the view.

If the namespace's apps send no traces, KubeDeck says so and lists the namespaces of this cluster that do.

## Read one trace

Click a trace to open it in a side panel. The waterfall shows each span as a bar on the trace's timeline, nested under the span that called it, coloured by service. Collapse a span to hide its children.

The panel opens on the first failing span. A span's details show:

- its status message and any exceptions, with type, message and stack trace;
- its attributes (host and SDK attributes are hidden until you select **Show every attribute**);
- its events;
- **Pod logs**, a link to the logs of the pod that ran it.

The header copies the trace id, opens the trace on its own page, and offers **Grafana** when a Grafana URL is configured.

### Logs next to spans

When [Grafana Loki](/integrations/loki) is also set up, a span's details include **Logs of &lt;pod&gt; at this time**: what that pod logged from 3 seconds before the span to 3 seconds after it. Error lines are highlighted. This often holds the exception the span itself lacks.

## Rollout check

On a Deployment's **Traces** tab, KubeDeck compares ReplicaSets that served traffic in the selected window. When more than one did, it compares the newest ReplicaSet with the older ones and shows one verdict:

- **New version looks no worse**
- **New version fails more**
- **New version is slower**
- **New version fails more and is slower**

Next to it are the error rate and p95 of the new version and of the ones before. The check is hidden when only one version served requests.

## Who sees which traces (web mode)

Traces carry URLs, ids and parts of payloads, so a shared KubeDeck shows a namespace's traces only to people who may list its pods there. KubeDeck checks this with `kubectl auth can-i list pods` as the identity it acts as for you.

- A namespace you cannot list pods in shows an error instead of traces.
- A trace that crosses namespaces shows only the spans from namespaces you may read. The header says how many spans are hidden.
- With **all namespaces** selected, you need to be able to list pods in every namespace. Otherwise pick one.

The desktop app shows whatever its Tempo returns.

[Ask Deck](/guide/assistant) uses the same data through its trace tools, with the same limits.
