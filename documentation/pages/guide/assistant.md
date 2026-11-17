---
title: "Ask Deck (assistant)"
description: "Ask KubeDeck's AI assistant about your cluster, approve the changes it proposes, and know what it can and cannot do."
---

# Ask Deck (assistant)

Ask Deck is KubeDeck's AI assistant. You ask a question in plain language ("why does checkout restart?"), and it reads the cluster with kubectl, looks at logs, events and traces, and answers with the evidence. It can propose a change, but nothing that changes the cluster runs until you approve it.

Ask Deck needs an AI provider. See [AI providers](/integrations/ai-providers). In web mode, **Ask Deck** is not in the sidebar when AI is off on the server or your groups do not allow it.

## Start a conversation

Open **Ask Deck** in the sidebar. The assistant works in the context and namespace selected in the header, shown next to the input. A namespace you selected limits what it lists: it does not widen a query to all namespaces on its own.

Pick a mode under the input:

| Mode | Use it for |
|---|---|
| **Chat** | Any question about the cluster |
| **Troubleshoot** | Finding the root cause of a failure: symptoms, then describe and logs of the worst resource, then the cause with evidence |
| **Briefing** | A short status report with a dashboard |
| **Investigate** | Following a request across services, watching logs live, asking you once for the entry point if it is unclear |

Each mode offers a few starting prompts, such as **Health board** or **Pod crash**. Press **Enter** to send and **Shift+Enter** for a new line.

Conversations are kept in this browser (or the desktop app) only, until you delete them. The history drawer lists them. They are not stored on the KubeDeck server.

## What it can do

The assistant has a fixed set of tools. Each tool says whether it only reads or may change something.

| Tool | What it does | Needs |
|---|---|---|
| `k8s_list` | Lists resources; can return exact counts (total, by status, not ready, restarts) | Always on |
| `k8s_describe` | Describes one resource | Always on |
| `k8s_logs` | Recent logs of a pod, deployment or service; the previous container's logs after a crash | Always on |
| `monitor_logs` | Watches a pod's logs and returns only new lines on each call | Always on |
| `kubectl` | Any kubectl command; context and namespace are added for you | Always on; changes need approval |
| `bash` | kubectl piped into text filters (`jq`, `grep`, `awk`, `sort`, `wc`…) | Always on; changes need approval |
| `present_dashboard` | Shows a dashboard in the chat: metrics, charts, issues and tables | Always on |
| `ask_human` | Pauses and asks you a question, with answer choices | Always on |
| `traces_stats`, `traces_search`, `trace_get` | Request rate, errors and latency from traces; finds and reads traces | [Grafana Tempo](/integrations/tempo) set up |
| `logs_search` | Log history, including pods that no longer exist | [Grafana Loki](/integrations/loki) set up |
| `grafana` | Grafana's read tools (queries, dashboards, alerts) | The Grafana plugin, see [Plugins](/integrations/plugins) |
| `mcp_<name>` | The tools of an MCP server you added | [MCP servers](/integrations/mcp-servers) |

The `bash` tool accepts only kubectl and text filters that read their input, never files. In web mode the pipeline runs without a shell.

## Approval before changes

Read commands run straight away. A command that changes the cluster stops the assistant and shows **This command changes your cluster**, with the exact command. Select **Run once** to run it, or **Deny**. Nothing runs until you choose.

Some commands never run, even with approval: `delete`, `drain`, `cordon`, `uncordon` and `taint`, and any pipeline that runs a program other than kubectl and the text filters. The rules are the same as in the [kubectl palette](/guide/kubectl-palette).

Tools of an MCP server that may change something follow the same rule: they wait for your approval, and only when that server allows changes.

::: callout info title:"Who the assistant acts as"
On the desktop, the assistant runs kubectl with your kubeconfig. On a shared web KubeDeck it acts as the signed-in person, so their RBAC applies. Cluster data the assistant reads is sent to the AI provider.
:::

## When the assistant only reads

The assistant cannot change anything when:

- the server runs with `KUBEDECK_READ_ONLY=true` (web mode). This also blocks change tools of MCP servers;
- your groups do not include the **Assistant may propose changes** permission (web mode).

In both cases a change is refused with a reason in the chat, instead of an approval prompt.

In web mode the assistant also refuses the same verbs and flags as the palette: `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach`, `debug`, and identity flags such as `--as`, `--token`, `--kubeconfig`, `--server`, `--user` and `--cluster`.

In web mode, trace and log-history tools only return data from namespaces where you may list pods.

## KubeDeck permissions (web mode)

An admin grants these per group in **Settings → Groups**. Admins have all of them. See [Permissions](/web/permissions).

| Permission | Without it |
|---|---|
| **Ask Deck (assistant)** | No Ask Deck, no inline AI actions, no plain-English commands in the palette |
| **Assistant may propose changes** | The assistant only reads, whatever the cluster allows |
| **MCP server tools** | The assistant does not get the `grafana` or `mcp_<name>` tools |

`KUBEDECK_AI=off` turns AI off for everyone on the server.

## AI elsewhere in KubeDeck

These one-shot actions use the same provider. They send data KubeDeck already loaded and stream back an answer.

| Where | Action |
|---|---|
| A resource's page | **Diagnose with AI** reads its describe output and events and gives a status, likely root cause, action items and risk. **Discuss in chat** carries on in Ask Deck |
| A resource's YAML | **Explain** walks through the manifest in plain English |
| [Logs](/guide/logs) | **Summarize** gives a few bullet points: what is happening, errors and their likely cause, and the next step |
| A resource's events | An **AI Summary** of the events, when a fast model is set |
| An unhealthy status badge | Hover it for one sentence on why and how to fix it, when a fast model is set |
| The kubectl palette | Plain English to a kubectl command |

## Ask the docs

The documentation KubeDeck serves at `/docs` has a chat box in the corner. It answers from these pages, through the same AI provider and model as Ask Deck, and links the pages it used. KubeDeck picks the matching sections on the server, so nothing goes to a third-party docs service. The chat shows only to someone KubeDeck lets use its AI: in web mode that means signed in, with the **Assistant** permission, and AI not turned off.
