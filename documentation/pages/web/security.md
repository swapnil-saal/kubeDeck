---
title: "Security model"
description: "Know what web mode protects, whose credentials each request uses, and what to check before you share KubeDeck with a team."
---

# Security model

A shared KubeDeck can reach your clusters, so it is built to keep each person inside the identity their groups give them. This page explains who can reach the server, which credentials each kubectl call uses, what people are kept from doing, and how secrets are stored. It ends with a checklist.

## Who can reach it

- **Only signed-in people.** Every API call except sign-in needs a session. Without one the answer is `401 Sign in required.`
- **No sign-up.** Admins create every account. Better Auth's own admin routes are not reachable from outside; admins use KubeDeck's routes, which validate what they store.
- **Only the public hostname.** API requests whose `Host` is not the hostname of `KUBEDECK_PUBLIC_URL` (or an extra host you listed) are refused. So are cross-site requests and requests whose `Origin` does not match. The answer is `403 Forbidden: KubeDeck only accepts requests from its own window.`
- **Optional group gate.** With `KUBEDECK_ALLOWED_GROUPS`, only people in one of those groups get in, admins included.

## Sign-in and sessions

- Passwords are 12 to 256 characters. The sign-in library, Better Auth, stores them hashed.
- Sessions are signed with `KUBEDECK_AUTH_SECRET`. They last 12 hours and are extended while in use.
- Cookies are named with the prefix `kubedeck` and are marked secure when `KUBEDECK_PUBLIC_URL` starts with `https://`.
- Sign-in is limited to 10 attempts a minute per address. KubeDeck sets the address itself from the connection, or from `X-Forwarded-For` through the number of proxies in `KUBEDECK_PROXY_HOPS`. A browser cannot choose it.
- Blocking an account signs it out at once. **Sign out everywhere** ends every session.

## Whose credentials a call uses

Every kubectl call carries the identity of the person who asked, even calls made deep inside the assistant's tools. On each cluster, that identity is the service account of each of the person's groups that covers the cluster, in the groups' order: impersonated through the cluster's connection, or a group's uploaded kubeconfig. The next one is tried only when the cluster answers Forbidden. See [Groups and cluster access](/web/groups#groups-and-cluster-access-which-identity-a-call-runs-as).

- **No group, no access.** When none of a person's groups covers a cluster, the call is refused before kubectl runs. This applies to admins too. Nobody acts as themselves or as KubeDeck's own connection.
- **No kubeconfig on disk.** Web mode points `KUBECONFIG` at an empty file at start. The only clusters are the ones an admin added in [Settings → Clusters](/web/clusters), and every call names its connection with `--kubeconfig`.
- **Fail closed.** A call with no person behind it, a call with no cluster, and a call through a connection that cannot be read all reach no cluster.
- **The connection works for KubeDeck only.** It is used to impersonate groups' service accounts and for admin screens: listing namespaces and service accounts, and checking impersonation. It never changes RBAC.
- **No shell.** kubectl runs with argument lists, never through a shell. Route parameters must look like Kubernetes names and may not start with `-`.

::: callout warning title:"What an admin can do"
An admin can add clusters, put anyone in any group (themselves too), pick any service account the cluster's connection may impersonate, and change Roles where the connection may. Give the admin role only to people you trust with that, and give each connection only the impersonation and RBAC rights it needs.
:::

## What people cannot do

The kubectl palette and the assistant are limited so nobody steps outside their identity:

- No `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach` or `debug`.
- No identity or connection flags: `--kubeconfig`, `--token`, `--server`, `-s`, `--as`, `--as-group`, `--as-uid`, `--client-certificate`, `--client-key`, `--certificate-authority`, `--insecure-skip-tls-verify`, `--username`, `--password`, `--user`, `--cluster`.
- The palette runs single kubectl commands only: no pipes or shell syntax. The assistant's pipelines run without a shell, and every kubectl in them gets the same checks.
- In both modes, `delete`, `drain`, `cordon`, `uncordon` and `taint` are refused in the palette and for the assistant. Other changes need a confirmation.
- With `KUBEDECK_READ_ONLY=true`, the UI refuses every change to a cluster, and the palette and the assistant only read.
- Port-forwarding is off. The port would open on the server, not on the person's machine.
- Pod files run only fixed read-only scripts in the container, and need exec rights there.

Group permissions can also turn the palette, the assistant, assistant changes, pod files, projects and MCP tools off per group. See [Permissions](/web/permissions).

## Secrets at rest

| Secret | Where | Protection |
|---|---|---|
| Passwords | Database | Hashed by Better Auth |
| Clusters' uploaded kubeconfigs (KubeDeck's connections) | Database | AES-256-GCM, key derived from `KUBEDECK_AUTH_SECRET` |
| Uploaded group kubeconfigs | Database | AES-256-GCM, a separate key derived from `KUBEDECK_AUTH_SECRET` |
| Plugin secrets, such as the AI provider's key | Database | AES-256-GCM, a separate key derived from `KUBEDECK_AUTH_SECRET` |
| Decrypted kubeconfigs (`kubectl` reads only files) | Private temporary folders (mode 700, files 600), in memory with the bundled manifest or `--tmpfs /tmp` | Written once at start and when clusters or groups change, removed when KubeDeck stops; folders left by a crashed KubeDeck are removed at the next start. A check copy exists only while an upload is verified |

A cluster added as **This cluster** stores nothing: KubeDeck reads its pod's service account token from the pod's token file on each use.

Uploaded kubeconfigs may hold only a token or an inline client certificate. Exec plugins, auth providers and file paths are refused, so an upload cannot run a program on the server. Stored secrets are never sent back to the browser.

## The container

The image runs as uid 1000 and holds no kubeconfig or secrets. The bundled manifest adds a read-only root filesystem, no privilege escalation, all capabilities dropped and the `RuntimeDefault` seccomp profile. KubeDeck uses the pod's service account only if an admin adds the cluster as **This cluster**. The `/healthz` probe returns `ok` and no data.

## Data that leaves the server

- **AI.** The assistant acts as the signed-in person, but the cluster data it reads is sent to the AI provider. Use a provider your organization allows, or set `KUBEDECK_AI=off`. See [AI providers](/integrations/ai-providers).
- **Audit log on stdout.** Each change is printed as one JSON line with the person and their address, for your log pipeline. See [Audit log](/web/audit-log).

## Checklist

- [ ] TLS on the ingress, and `KUBEDECK_PUBLIC_URL` set to the `https://` address.
- [ ] `KUBEDECK_AUTH_SECRET` random, at least 32 characters, stored only in a Secret.
- [ ] `KUBEDECK_PROXY_HOPS` set to the number of proxies in front.
- [ ] Each cluster's connection may impersonate only the service accounts groups use (`resourceNames`).
- [ ] Groups' service accounts and RoleBindings are as narrow as works. **Read secrets** only where every secret in the namespace may be read.
- [ ] The admin role given only to the people who need it.
- [ ] The first admin's password changed if it was ever pasted anywhere.
- [ ] The AI provider approved for cluster data, or `KUBEDECK_AI=off`.
- [ ] The database backed up, together with the secret.
- [ ] The image pulled by an exact tag.
