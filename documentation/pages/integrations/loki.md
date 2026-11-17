---
title: "Grafana Loki"
description: "Connect KubeDeck to Grafana Loki so traces show the pod's log lines and the assistant can read log history, including pods that are gone."
---

# Grafana Loki

The **Loki logs** plugin connects KubeDeck to Grafana Loki's HTTP API. It adds log history that `kubectl logs` no longer has: the lines a pod wrote while a traced request ran, and up to 7 days of logs for the assistant, including pods that were replaced or crashed. KubeDeck only sends GET requests to Loki.

## What it adds

| Where | What |
| --- | --- |
| Trace view | Next to a span, the lines its pod wrote from a few seconds before the span to a few seconds after it |
| Assistant | The `logs_search` tool: log history for a namespace, workload or pod, over the last 15 minutes up to 7 days, with a text filter and an errors-only filter |

Live logs in KubeDeck still come from `kubectl logs`. Loki is for what is already gone. See [Logs](/guide/logs).

::: callout info
The trace view needs the [Tempo traces](/integrations/tempo) plugin too. Without Tempo, Loki still gives the assistant its `logs_search` tool.
:::

## What Loki must have

KubeDeck builds a LogQL query from labels your collector sets:

| Label | Used for |
| --- | --- |
| `cluster` | Which cluster (indexed label, part of the stream selector) |
| `namespace` | Which namespace (indexed label, part of the stream selector) |
| `pod` | The pod. Matched with a label filter, so it works as a label or as structured metadata |
| `service_name` | A Service's logs, when no pod is given |

For a workload, KubeDeck matches the names its pods get: `api-7f59d5f6c8-2wxvz` for a Deployment, `db-0` for a StatefulSet, and so on. So `checkout` does not match `checkout-worker`.

The `cluster` value for a kube context comes from the Tempo plugin's Clusters map, then from Tempo's own cluster matching, and otherwise is the context name. If your Loki `cluster` label differs from the context name and you do not run Tempo, the assistant's queries will not find the streams.

## Configure it

Configure the plugin in **Settings → Plugins → Loki logs**, or from the server's environment. A variable that is set wins and shows read-only on the page.

| Field | Variable | Meaning |
| --- | --- | --- |
| **Loki URL** (required) | `KUBEDECK_LOKI_URL` | Loki's HTTP API, e.g. `https://loki.example.com` |
| **Token** | `KUBEDECK_LOKI_TOKEN` | Sent as `Authorization: Bearer <token>` when Loki needs one. Stored encrypted |
| **Tenant** | `KUBEDECK_LOKI_TENANT` | Sent as `X-Scope-OrgID`, for a multi-tenant Loki |

The plugin is on by default when it has a URL. The URL must start with `http://` or `https://`.

```yaml
env:
  - { name: KUBEDECK_LOKI_URL, value: "https://loki.example.com" }
  - { name: KUBEDECK_LOKI_TENANT, value: "prod" }
```

**Test connection** asks Loki for its label names (`/loki/api/v1/labels`). That checks the URL, token and tenant together.

## Who sees which logs

On the desktop, you see whatever your Loki returns.

In web mode, a namespace's log history is shown only to someone who may `list pods` there, checked as that person with `kubectl auth can-i`. The assistant runs as the person too, so the same applies to its `logs_search` calls.

## Limits

- One query covers at most 7 days.
- KubeDeck waits 25 seconds for Loki. After that it asks you to try a shorter time range or a narrower filter.
- A namespace must be picked. KubeDeck does not query Loki across all namespaces.

## Troubleshooting

| Message | What to do |
| --- | --- |
| "Log history is not set up." | Switch on Loki logs in Settings → Plugins, or set `KUBEDECK_LOKI_URL` |
| "Cannot reach Loki at …" | The KubeDeck server cannot reach the URL |
| "Loki sent something that is not JSON." | The URL does not point at Loki's HTTP API |
| "Loki answered 401" or "403" | Check the token and tenant |
| "You cannot list pods in …, so its logs are hidden." | Web mode: the person needs `list pods` in that namespace |

## Related

- [Grafana Tempo](/integrations/tempo)
- [MCP servers](/integrations/mcp-servers): the Grafana MCP server gives the assistant another way into Loki
- [Plugins](/integrations/plugins)
