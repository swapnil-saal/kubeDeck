---
title: "MCP servers"
description: "Give the assistant tools from remote MCP servers, built-in Grafana or any server you add, and control which tools it may call, for whom, and with whose approval."
---

# MCP servers

An MCP server offers tools over the Model Context Protocol: runbooks, tickets, metrics, code. When you connect one, Ask Deck can call its tools while it answers. KubeDeck connects to **remote** servers only, offers only tools that read unless you allow more, and makes every call that may change something wait for approval in the chat.

## How KubeDeck keeps it safe

| Rule | What it means |
| --- | --- |
| Remote servers only | KubeDeck connects over HTTP(S), with Streamable HTTP or the older SSE transport. It never starts a local (stdio) server, which would run commands on the KubeDeck host |
| Read-only by default | Only tools that read are offered until an admin turns on **Allow changes** for that server |
| Changes need approval | With Allow changes on, every call of a tool that may change something waits for the person's approval in the chat |
| Per-group access | A server can be limited to some KubeDeck groups. Nobody else's assistant sees its tools |
| Your permissions, not the server's | In web mode, the **MCP server tools** permission decides who may use MCP tools at all |

## Settings → MCP servers

The page lists the servers on the left, in two groups: **Built in** (Grafana) and **Added**. Select one to see its detail:

- Its state, host and a tool count, for example "6 tools (2 need approval)".
- **Settings** and the on/off switch, for admins.
- Its **Tools**, grouped by what the assistant may do with them.

An expandable **How MCP servers stay safe** section at the bottom repeats the rules above.

In web mode everyone signed in can see the page and the tool lists. Only a KubeDeck admin can add servers, switch them on or off and change their settings.

### The tool catalog

KubeDeck lists every tool the server offers and puts each in one of three groups:

| Group | Label | What happens |
| --- | --- | --- |
| Read | "Reads" | The assistant calls it when it needs to |
| Approval | "Needs approval in the chat" | Each call waits until the person in the chat approves it |
| Hidden | "Not offered to the assistant" | The assistant never sees it. The page says why, for example "It may change things, and Allow changes is off." |

The tools appear once the server has answered. KubeDeck keeps the server's tool list for five minutes; **Test connection** asks again right away.

### How KubeDeck decides a tool only reads

KubeDeck decides this itself, from the tool's name and the server's annotations. A tool that might change something is never treated as a read.

1. If the server marks the tool destructive, or marks it as not read-only, it is not a read.
2. If any word of the name is a write word (`create`, `update`, `delete`, `run`, `exec`, `apply`, `restart`, `scale`, `send` and many more), it is not a read.
3. Otherwise it is a read when its first word is a read verb (`get`, `list`, `search`, `query`, `describe`, `show` and others), or the server marks it read-only.

Names are split on `_`, `-`, `.`, `/` and camelCase, so `list_pods`, `list-pods` and `listPods` are treated the same.

## Add an MCP server

::: steps
::: step "Open Settings → MCP servers"
Click **Add MCP server**. Only admins (and the desktop's user) see the button.
::: /step
::: step "Name it"
**Name** is how the assistant and the page call it, up to 40 characters, e.g. `GitHub`.
::: /step
::: step "Give its URL"
**Server URL** is the remote endpoint, e.g. `https://mcp.example.com/mcp`. It must start with `http://` or `https://`.
::: /step
::: step "Add a token if it needs one"
**Token** is optional. It is sent as `Authorization: Bearer <token>`, stored encrypted and never shown again.
::: /step
::: /steps

The server starts on and read-only. Its tools show once it answers. The rest of its settings are under **Settings** in its detail view.

Each added server becomes one assistant tool named `mcp_<name>`. For example, a server named "GitHub tools" becomes `mcp_github_tools`. The assistant passes the server's tool name and arguments to it.

## Server settings

| Setting | Default | Meaning |
| --- | --- | --- |
| **Server URL** | (required) | The remote endpoint. Local (stdio) servers are not supported |
| **Transport** | Streamable HTTP | Choose **SSE (older servers)** only if the server does not speak Streamable HTTP |
| **Token** | none | Sent as `Authorization: Bearer <token>`. Stored encrypted |
| **Extra headers** | none | Name → value pairs sent with every request. Not secret: put credentials in Token |
| **Allow changes** | Off | Off: only tools that read. On: the other tools too, and every call of one waits for approval |
| **Only these tools** | empty | Tool names. Empty allows every tool the read/change rule allows. Tools not in the list are hidden |
| **Only for these groups** | empty | KubeDeck groups whose members get this server's tools. Empty means everyone. The desktop app has no groups |

::: callout warning title:"Read-only KubeDeck"
On a web-mode KubeDeck with `KUBEDECK_READ_ONLY=true`, Allow changes has no effect: tools that may change something stay hidden, with the reason "It may change things, and this KubeDeck is read-only."
:::

## Who may use MCP tools (web mode)

A person's assistant gets a server's tool only when all of these hold:

1. Their KubeDeck groups include the **MCP server tools** permission (Settings → Groups → Edit). Admins have every permission.
2. The server has no **Only for these groups** list, or they are in one of its groups.
3. The server is on and answers.

A call of a tool that needs approval is also refused when:

- the person's groups do not include **Assistant may propose changes** ("your KubeDeck groups let the assistant read only"), or
- the KubeDeck is read-only.

See [Permissions](/web/permissions) for the full list of KubeDeck permissions.

On the desktop there are no groups: you get every server that is on.

## Grafana (built in)

The built-in **Grafana** server connects to the [Grafana MCP server](https://github.com/grafana/mcp-grafana). The assistant gets one tool, `grafana`, that reads Prometheus metrics, Loki logs, dashboards, alert rules and incidents.

| Field | Variable | Meaning |
| --- | --- | --- |
| **Grafana MCP server URL** (required) | `KUBEDECK_GRAFANA_MCP_URL` | Its Streamable HTTP endpoint, usually ending in `/mcp`, e.g. `https://grafana-mcp.example.com/mcp` |
| **Token** | `KUBEDECK_GRAFANA_MCP_TOKEN` | Sent as `Authorization: Bearer <token>` if the server needs one |

It is on by default when it has a URL. A variable that is set wins and shows read-only on the page.

Grafana is always read only in KubeDeck, whatever the server allows. On top of the read rule above, KubeDeck leaves out Grafana's raw queries (`run_panel_query`, `query_sql`, `query_influxdb`), the generic API tool (`grafana_api_request`), image renders and anything that creates, updates or deletes. Run the Grafana MCP server with `--disable-write` anyway.

::: callout warning title:"Grafana data is not filtered per person"
Everyone who may use MCP tools reads what the Grafana MCP server's own Grafana token can read. KubeDeck's per-namespace checks do not apply to it.
:::

## Limits

- KubeDeck waits up to 60 seconds for one tool call.
- A tool result longer than 14,000 characters is cut, and the model gets the start with a note.
- A server listing more than 500 tools is cut off at 500.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "The tools show here once … answers." | The server has not answered yet. Switch it on, check the URL and token, then **Test connection** |
| Unconfigured: "Set the server's URL (http or https)." | The URL is missing or not http(s) |
| A tool you expected is under Hidden | Read its reason. Turn on Allow changes, or add it to Only these tools |
| The assistant says the server is unreachable | KubeDeck tells the model the server is configured but not answering. Check the server and the network path from KubeDeck |
| Someone does not get the tool | Check their groups' MCP server tools permission and the server's Only for these groups list |

## Related

- [Ask Deck (assistant)](/guide/assistant)
- [Plugins](/integrations/plugins)
- [Permissions](/web/permissions)
- [AI providers](/integrations/ai-providers)
