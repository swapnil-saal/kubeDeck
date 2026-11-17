---
title: "Troubleshooting"
description: "Match the message you see in web mode to its cause and fix it."
---

# Troubleshooting

Most problems in web mode show a specific message, in the server's log or in the browser. Find the message below to see what causes it and what to do. For more detail in the log, start the server with `KUBEDECK_DEBUG=1`.

## The server does not start

The pod restarts (`CrashLoopBackOff`) and its log names the problem. Each line starts with `[kubedeck]`.

| Message | Cause and fix |
|---|---|
| ``Web mode needs KUBEDECK_AUTH_SECRET of at least 32 characters (e.g. `openssl rand -base64 32`).`` | The secret is missing or short. Set one of 32 or more characters, and keep it. |
| `Web mode needs KUBEDECK_PUBLIC_URL, the address people open (e.g. https://kubedeck.example.com).` | The URL is missing or has no `http://` or `https://`. |
| `Set KUBEDECK_PUBLIC_URL (e.g. https://kubedeck.example.com) so requests for other hostnames are refused.` | Same: no public hostname is known. |
| `KUBEDECK_ADMIN_PASSWORD must be at least 12 characters.` | Use a longer first-admin password. |
| `Web mode cannot start without its database: cannot create … for the SQLite database (…)` | The database folder cannot be created, usually on a read-only root filesystem. Set `KUBEDECK_DATABASE_URL=sqlite:/data/kubedeck.db` with a volume at `/data`, or use Postgres. |
| `KUBEDECK_DATABASE_URL must start with postgres:// or sqlite: (got "…").` | Fix the scheme. See [Database](/web/database). |

## Warnings on start

| Message | Meaning |
|---|---|
| `No users yet. Set KUBEDECK_ADMIN_EMAIL and KUBEDECK_ADMIN_PASSWORD to create the first admin.` | Nobody can sign in yet. Set both and restart. |
| `<email> does not exist yet: set KUBEDECK_ADMIN_PASSWORD to create it.` | The admin email is set without a password. |
| `Group <name>: the kubeconfig for <cluster> cannot be decrypted (was KUBEDECK_AUTH_SECRET changed?). Upload it again.` | The secret changed. Upload that group's kubeconfig again in **Settings → Groups**. |
| `Cluster <name>: its connection cannot be read (was KUBEDECK_AUTH_SECRET changed?). Add it again.` | The secret changed. Choose **Upload a new kubeconfig** on that cluster's row in **Settings → Clusters**. |
| `Cluster <name>: its connection cannot be read (not running in that cluster). Add it again.` | The cluster was added as **This cluster**, but KubeDeck no longer runs in a pod. |
| `KUBEDECK_ACCESS is no longer used: clusters come from Settings → Clusters and access from Settings → Groups.` | A retired variable is still set. The same message names `KUBEDECK_IMPERSONATE_PREFIX` and `KUBEDECK_IMPERSONATE_GROUP_PREFIX`. Remove them; set up [clusters](/web/clusters) and [groups](/web/groups) instead. |

## Opening the page and signing in

| You see | Cause and fix |
|---|---|
| `Forbidden: KubeDeck only accepts requests from its own window.` | The hostname in the address bar is not the one in `KUBEDECK_PUBLIC_URL`. Open that address, or add the hostname to `KUBEDECK_PUBLIC_HOSTS`. |
| `KubeDeck is still starting. Try again in a moment.` | The database and sign-in are still loading. Wait a few seconds. |
| `That email and password do not match an account.` | Wrong email or password. An admin can set a new password in **Settings → Users**. |
| `Too many attempts. Wait a minute and try again.` | 10 sign-in attempts a minute per address. Behind an ingress, set `KUBEDECK_PROXY_HOPS=1`, or everyone shares the ingress's address and one limit. |
| A message that the account is blocked or banned | An admin blocked the account. They can choose **Unblock sign-in** in **Settings → Users**. |
| `Your account is not in a group that may use KubeDeck.` | `KUBEDECK_ALLOWED_GROUPS` is set and the person is in none of those groups. This applies to admins too. |
| Signed out after a while | Sessions last 12 hours, extended while in use. A changed `KUBEDECK_AUTH_SECRET` signs everyone out at once. |

## Empty lists and access denied

| You see | Cause and fix |
|---|---|
| The scope switcher says `No clusters for you yet. …` | None of the person's groups has a service account on any cluster. This applies to admins too. Add the cluster in **Settings → Clusters** if needed, give a group of theirs a service account on it, and check the person is in that group. |
| `none of your KubeDeck groups gives you access to cluster "<cluster>". Ask a KubeDeck admin.` | Same, for one cluster, for example from a link or a project that names it. |
| `pick a cluster: a shared KubeDeck has no default cluster.` | The request named no cluster. Pick one in the scope switcher. |
| `Access denied: this account cannot list deployments.apps in namespace shop` | None of the person's service accounts on that cluster has that permission. Check the person's groups in **Settings → Users** under **Cluster access**, then the group's **Permissions** or your RoleBindings for its service account. |
| `… cannot impersonate resource "serviceaccounts" …` | The cluster's connection may not impersonate the group's service account. Allow it (see [What the connection needs](/web/clusters#clusters-what-the-connection-needs)), or upload that account's kubeconfig to the group. |
| Buttons missing that RBAC now allows | KubeDeck keeps each person's permission answers for a minute. Wait, then reload. |
| `Can't reach the cluster. Check your VPN or network connection.` | KubeDeck cannot reach the API server from where it runs. Check the server address in the cluster's or group's kubeconfig, and the network from the pod or container. |

## Settings → Clusters

| You see | Cause and fix |
|---|---|
| `A cluster named <name> already exists.` | Names are unique. Pick another, or reconnect the existing cluster. |
| `Not a valid cluster name.` | Use letters, digits and `. _ : @ / + = -`, not starting with `-`. |
| `The cluster refused these credentials (the token may be expired or revoked).` | `kubectl auth whoami` failed with the uploaded kubeconfig. Create a fresh token. |
| `The kubeconfig uses an exec plugin (it would run a program on the KubeDeck server). Upload one with a service account token instead.` | Only a token or an inline client certificate is accepted. The same message names other refused fields: an auth provider, file paths, a username and password, impersonation. The other kubeconfig messages are the same as for groups, below. |
| `KubeDeck is not running inside a Kubernetes cluster, so it has no service account of its own to use.` | **This cluster** works only when KubeDeck runs in a pod. Upload a kubeconfig instead. |
| `<group> still uses <cluster>. Remove it from that group first.` | Take the cluster out of those groups in **Settings → Groups**, then remove it. |
| **signs in as unknown** on a row | The cluster could not say who the connection is when it was saved, for example because it was unreachable. Check the server address, then reconnect. |

## Settings → Groups

| You see | Cause and fix |
|---|---|
| `There is no cluster named <cluster>. Add it under Settings → Clusters first.` | Groups can use only clusters listed in **Settings → Clusters**. |
| `KubeDeck may not impersonate service accounts in <namespace> on <cluster>.` | The cluster's connection lacks `impersonate` on that service account (the form checks the account you picked). Allow it, for example with `resourceNames` naming that account, or choose **Upload a kubeconfig instead**. See [What the connection needs](/web/clusters#clusters-what-the-connection-needs). |
| `KubeDeck's credentials for <cluster> may not list service accounts in <namespace>.` | The cluster's connection may not list them. Type the service account's name, or give the connection `list` on `serviceaccounts`. |
| `<cluster>: The kubeconfig uses an exec plugin (it would run a program on the KubeDeck server). Upload one with a service account token instead.` | Only a token or an inline client certificate is accepted. The same message names other refused fields: an auth provider, file paths, a username and password, impersonation. |
| `<cluster>: The kubeconfig points at a CA file: use certificate-authority-data instead.` | Inline the CA as `certificate-authority-data`. |
| `<cluster>: Kubeconfigs with a proxy-url are not accepted.` | Remove `proxy-url`. |
| `<cluster>: The kubeconfig has several contexts and none is named <cluster> or current: keep only the one to use.` | Keep one context, name it like the cluster, or set `current-context`. |
| `<cluster>: The kubeconfig's user has no token or client certificate.` | Add a token or inline certificate and key. |
| `<cluster>: The cluster refused these credentials (the token may be expired or revoked).` | `kubectl auth whoami` failed with these credentials. Create a fresh token. |
| `Upload a kubeconfig for <cluster>.` | The entry switched to **Upload kubeconfig** has no file yet. |
| `A group acts as one identity per cluster.` | The same cluster is listed twice. Remove one. |
| `<group> still has <n> members. Remove them from the group first.` | Take everyone out of the group before deleting it. |
| `No group named <id>. Create it under Settings → Groups first.` | An account can only be in groups defined in **Settings → Groups**. |

## Features refused

| You see | Cause and fix |
|---|---|
| `Your KubeDeck groups do not include <feature>. Ask a KubeDeck admin.` | None of the person's groups allows that feature. Switch it on in **Settings → Groups → Edit** for one of them. |
| `Blocked: your KubeDeck groups let the assistant read only.` | **Assistant may propose changes** is off in all of their groups. |
| `This KubeDeck is read-only. Scaling, restarting, editing and deleting are turned off here.` | `KUBEDECK_READ_ONLY=true`. |
| `This KubeDeck is read-only: only read commands can run here.` | Same, from the palette. |
| `That flag is not allowed on a shared KubeDeck.` | The palette or assistant command used an identity flag such as `--as` or `--kubeconfig`. |
| `kubectl exec is not available on a shared KubeDeck.` | Also for `config`, `auth`, `cp`, `port-forward`, `proxy`, `attach`, `debug`. |
| `Pipes and shell syntax are not available on a shared KubeDeck.` | The palette runs one kubectl command at a time in web mode. |
| `Command 'delete' is blocked for safety. Use the KubeDeck UI or run it manually in your terminal.` | The palette refuses `delete`, `drain`, `cordon`, `uncordon` and `taint`. Use the resource's actions instead. |
| `Port forwarding is not available on a shared KubeDeck: …` | Use the desktop app for port-forwarding. |
| `The AI assistant is turned off on this KubeDeck.` | `KUBEDECK_AI=off`. |
| `Browsing pod files is turned off on this KubeDeck.` | `KUBEDECK_POD_FILES=off`. |
| `Only its creator or an admin can change this project.` | Projects are shared, but only their creator or an admin changes them. |

## Users

| You see | Cause and fix |
|---|---|
| `You cannot remove your own admin role. Ask another admin.` | Another admin must change your role. |
| `You cannot block your own account.` / `You cannot delete your own account.` | Same: ask another admin. |
| `Only a KubeDeck admin can manage users.` | The account is not an admin. The same holds for `… manage clusters.` and `… manage groups.` |

## Logs and streams

| You see | Cause and fix |
|---|---|
| Live logs stop after a while | A proxy buffers or times out long responses. With ingress-nginx, keep the manifest's `proxy-read-timeout: "3600"` and `proxy-buffering: "off"` annotations, or the equivalent for your controller. |
