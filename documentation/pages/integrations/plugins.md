---
title: "Plugins"
description: "Switch KubeDeck's built-in integrations on and off, configure them under Settings → Plugins or from the environment, and know how their secrets are stored."
---

# Plugins

Plugins are the parts of KubeDeck you switch on, configure and check yourself: traces from Grafana Tempo, log history from Grafana Loki, Grafana through its MCP server, and the assistant's Kubernetes tools. Switching one on or changing its settings takes effect at once, without a restart.

## The built-in plugins

| Plugin | Category | What it adds | Configure it |
| --- | --- | --- | --- |
| **Kubernetes tools** | Core | The assistant's cluster tools: `k8s_list`, `k8s_describe`, `k8s_logs`, `kubectl`, `bash`, `monitor_logs`, `ask_human`, `present_dashboard`. Always on, nothing to set | Nothing to configure |
| **Tempo traces** | Observability | The workload **Traces** tab, **Overview → Traces**, and the assistant's `traces_stats`, `traces_search` and `trace_get` tools | [Grafana Tempo](/integrations/tempo) |
| **Loki logs** | Observability | A pod's log lines next to a traced request, and the assistant's `logs_search` tool | [Grafana Loki](/integrations/loki) |
| **Grafana** | MCP servers | The assistant's `grafana` tool: Prometheus metrics, Loki logs, dashboards, alert rules and incidents, read only | [MCP servers](/integrations/mcp-servers) |

Two more kinds of plugin live on their own pages:

- The **AI provider** is kept as a plugin (id `ai`) but is set under **Settings → AI assistant**. See [AI providers](/integrations/ai-providers).
- **MCP servers** you add by URL, and the built-in Grafana one, are under **Settings → MCP servers**. See [MCP servers](/integrations/mcp-servers).

## Settings → Plugins

The page shows the plugins as cards, grouped by category (**Core**, **Observability**). Each card shows the plugin's state:

| State | Meaning |
| --- | --- |
| Off | Switched off |
| Unconfigured | On, but a required setting is missing or invalid (for example "Set the URL.") |
| OK | Its last check worked. Some plugins add a short fact, such as how many clusters Tempo knows |
| Error | Its last check failed, with the message |

Open a card to see its settings panel: what it adds, its fields, **Save**, **Test connection** and the on/off switch.

::: steps
::: step "Switch it on"
Use the switch on the card or in the panel. A plugin that the environment configures with a URL starts on by default.
::: /step
::: step "Fill in the fields"
Save sends only the fields you changed. The plugin restarts with the new settings and shows its status.
::: /step
::: step "Test connection"
Runs a fresh check against the service. Save first: the button asks you to while you have unsaved changes, and it needs the plugin to be on.
::: /step
::: /steps

### Who may change plugins

| Mode | Sees the page | Changes settings, switches, adds and removes |
| --- | --- | --- |
| Desktop | You | You |
| Web | Everyone signed in (names, state, what each adds) | KubeDeck admins only. Others get "Only a KubeDeck admin can change plugins." |

People who may not manage plugins never receive the settings values.

Every change (on, off, settings, added, removed) is announced as a `plugin.changed` event, and lands in the [Audit log](/web/audit-log) like any other write.

## Settings pinned by the environment

A plugin's value comes from, strongest first:

1. The server's environment, such as `KUBEDECK_TEMPO_URL`.
2. What an admin saved under Settings.
3. The field's default, if it has one.

A field set by the environment shows "Set by the server" and cannot be edited on the page. Empty variables pin nothing. Each plugin's page lists its variables; [Environment variables](/reference/environment-variables) has them all.

## How secrets are stored

Fields of the kind "secret" (tokens, the AI provider's API key) are handled apart from the rest:

- They are encrypted before they are stored, with AES-256-GCM (`server/secrets.ts`).
- They are never sent back to the browser. The panel shows that a value is stored; type a new one to replace it, or choose **Keep stored**. An empty value on save keeps the stored secret.

The encryption key depends on the mode:

::: tabs
::: tab "Web"
Derived from `KUBEDECK_AUTH_SECRET`, so every replica uses the same key.

If you change `KUBEDECK_AUTH_SECRET`, stored secrets can no longer be read. Enter them again.
::: /tab
::: tab "Desktop"
A random key in `~/.kubedeck/plugins.key`, created on first use and readable only by your user.

If `KUBEDECK_AUTH_SECRET` is set in the app's environment, the key is derived from it instead.
::: /tab
::: /tabs

## Where plugin settings live

Plugin choices are rows of the `plugin_state` table in KubeDeck's database: `~/.kubedeck/kubedeck.db` on the desktop by default, or wherever `KUBEDECK_DATABASE_URL` points. Without a database they are kept in memory for that run only. See [Database](/web/database).

On the desktop, values from the old **Settings → Observability** block of `~/.kubedeck/settings.json` are moved into the Tempo, Loki and Grafana plugins once, for each plugin that has no saved settings yet.

## Related

- [Grafana Tempo](/integrations/tempo)
- [Grafana Loki](/integrations/loki)
- [MCP servers](/integrations/mcp-servers)
- [Architecture](/reference/architecture)
