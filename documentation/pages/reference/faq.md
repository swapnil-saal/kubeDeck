---
title: "FAQ"
description: "Answers to common questions about KubeDeck: permissions it needs, where it keeps data, offline use, what the AI provider sees, and access errors in web mode."
---

# FAQ

Short answers to the questions people ask most, with links to the pages that go deeper.

## Does KubeDeck need cluster-admin?

No.

- **Desktop:** KubeDeck runs `kubectl` with your kubeconfig, so it can do exactly what you can. Resource kinds you may not list are left out of the sidebar, and actions you may not take are not offered.
- **Web:** each cluster an admin adds in **Settings → Clusters** has a connection: the credentials KubeDeck itself uses there. It needs `impersonate` on the service accounts groups pick, best named with `resourceNames`. Listing namespaces and service accounts for the group form is an optional extra. People act only as their groups' service accounts, so what those may do is up to you.

::: callout warning
In web mode, an admin can put themselves in any group and change what a group's service account may do where the connection allows it. Make someone an admin only if you trust them with that.
:::

See [Clusters](/web/clusters), [Groups and cluster access](/web/groups) and [Security model](/web/security).

## Does it install anything in my cluster?

KubeDeck has no agent or operator. It talks to the API server through `kubectl` only.

It writes to a cluster only when someone asks it to: an action such as scale or restart, the palette, the assistant after approval. It never changes RBAC on its own: a group's service account gets its permissions from the Roles and bindings a cluster admin creates.

## Where does KubeDeck keep its data?

::: tabs
::: tab "Desktop"
| What | Where |
| --- | --- |
| Kubeconfig paths chosen in Settings → Clusters | `~/.kubedeck/settings.json` |
| Audit log, plugin settings, AI provider settings, projects | `~/.kubedeck/kubedeck.db` (SQLite) |
| Key that encrypts stored secrets | `~/.kubedeck/plugins.key` |
| Ask Deck conversations | In the app (IndexedDB), until you delete them |
| Theme | In the app, on this device |
:::
::: tab "Web"
| What | Where |
| --- | --- |
| Accounts, sessions, clusters and their connections, groups, projects, plugin settings, AI provider settings, audit log | The database: `KUBEDECK_DATABASE_URL` (SQLite file or Postgres) |
| Encryption key for stored secrets | Derived from `KUBEDECK_AUTH_SECRET`; not stored |
| Ask Deck conversations | Each person's browser (IndexedDB). The server keeps none |
| Audit records | Also printed as one JSON line each on stdout |
:::
::: /tabs

Back up the web-mode database: it holds everything except chats. See [Database](/web/database).

## Can I use it offline?

The desktop app needs no cloud service of its own. It needs `kubectl` and a network path to your clusters, and nothing else.

The AI features need a model provider. To keep those local too, run [Ollama](/integrations/ai-providers) or another OpenAI-compatible model on your network. Tempo, Loki and MCP servers are optional and only reached when you configure them.

The documentation is served by KubeDeck itself at `/docs`.

## What does the AI provider see?

Your question, and the cluster data the feature works with. For Ask Deck that includes the output of the commands it runs (resource lists, YAML, events, logs), plus traces and log history when those plugins are on. KubeDeck does not filter that output before sending it.

What limits it:

- The assistant reads only what the person may read: in web mode it acts as the signed-in person's service accounts.
- In web mode an admin can turn AI off (`KUBEDECK_AI=off`) or take the **Ask Deck (assistant)** permission away from groups.
- A self-hosted model keeps the data in your network.

See [AI providers](/integrations/ai-providers).

## Can the assistant change my cluster?

Only with approval. Commands that read run straight away; commands that change something wait until you approve them in the chat. Some verbs (`delete`, `drain`, `cordon`, `uncordon`, `taint`) are refused for the assistant even with approval.

In web mode it is limited further:

- With `KUBEDECK_READ_ONLY=true` it only reads.
- Without the **Assistant may propose changes** permission, it only reads.
- It cannot run `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach` or `debug`, or pass identity flags such as `--as`, `--token`, `--kubeconfig`, `--user` or `--cluster`.

See [Ask Deck (assistant)](/guide/assistant).

## Why does a cluster say access denied in web mode?

KubeDeck runs every kubectl call as the service accounts the person's groups have on that cluster, so the cluster's RBAC decides. Check, in this order:

1. **Their groups.** Does one of their groups have a service account on this cluster (Settings → Groups)? If not, they have no access there at all, even as an admin: `none of your KubeDeck groups gives you access to cluster "<cluster>"`. The cluster is then missing from their scope switcher.
2. **The service account's permissions.** Its Roles and bindings on the cluster decide; the group's **RBAC** menu opens them. `kubectl auth can-i --list -n <namespace> --as=system:serviceaccount:<ns>:<name>` shows what it may do.
3. **Impersonation.** For a service account picked from the cluster, the cluster's connection (Settings → Clusters) needs `impersonate` on it. "cannot impersonate" in the error means this is missing.
4. **KubeDeck permissions.** A message such as "Your KubeDeck groups do not include kubectl palette" is not RBAC: it is a KubeDeck permission on the group. See [Permissions](/web/permissions).
5. **Allowed groups.** "Your account is not in a group that may use KubeDeck" means the server sets `KUBEDECK_ALLOWED_GROUPS` and the person is in none of them.

More in [Troubleshooting](/web/troubleshooting).

## Why can I not port-forward in web mode?

The port would open inside the KubeDeck server, not on your machine. Port-forward is a desktop feature only.

## Can several people share one desktop app's settings?

No. The desktop app is one person's tool: one local user who never signs in. To share KubeDeck with a team, run [web mode](/web/overview).

## Can I run more than one replica?

Yes, with Postgres (`KUBEDECK_DATABASE_URL=postgres://…`). With SQLite, run exactly one replica; the manifest uses the `Recreate` strategy for that reason. See [Database](/web/database).

## Do I need to restart KubeDeck after changing a plugin?

No. Saving a plugin's settings, or switching it, restarts that plugin only. Environment variables are the exception: they are read when KubeDeck starts.

## Where do I report a bug or read the code?

On [GitHub](https://github.com/swapnil-saal/kubeDeck). To work on KubeDeck, start with [Development setup](/contributing/development).
