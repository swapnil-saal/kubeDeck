---
title: "Audit log"
description: "Find who changed what through KubeDeck, read the audit log in Settings or from the server's output, and know what it records."
---

# Audit log

KubeDeck records every change made through it: scaling, restarts, edits, deletes, palette commands, assistant requests, and changes to users, groups, plugins and projects. Each entry names the person, their groups, where it happened and whether it went through. Admins read it in **Settings → Audit log**; web mode also prints each entry to the server's output.

The desktop app keeps an audit log too, in `~/.kubedeck/kubedeck.db`, under your computer's user name.

## What is recorded

One entry per request that changes something: every `POST`, `PUT`, `PATCH` or `DELETE` to KubeDeck's API. Refused and failed requests are recorded too, with their status.

| Field | Meaning |
|---|---|
| Time | When the request finished. |
| Person | Their email and name. |
| Groups | Their KubeDeck groups at that moment. |
| Method and path | The API request, shown in words in Settings. |
| Status | The HTTP status of the answer. |
| Cluster and namespace | The context and namespace the request named, when it named them. |
| Detail | For palette runs, the kubectl command, up to 1,000 characters. |
| Address | The person's IP address. Behind a proxy, set `KUBEDECK_PROXY_HOPS` so this is not the proxy's address. |

Not recorded:

- Reads: lists, details, logs.
- Sign-in and sign-out.
- Each command the assistant runs inside one request. The request shows as **Asked the assistant**. Approved changes are also printed to the server's output, as below.

KubeDeck does not delete entries. Deleting an account keeps the entries it made.

## Read it in Settings

Open **Settings → Audit log**. Only admins see it. Entries are newest first, 100 at a time; **Show older** loads more.

Each entry reads as a sentence, such as **Scaled deployment** `web`, **Ran a kubectl command** with the command below it, or **Set a new password for** `dana@example.com`. Next to it:

| Result | Status |
|---|---|
| **Done** | Below 400 |
| **Refused** | 401 or 403: KubeDeck or the cluster said no |
| **Failed** | Any other error |

Filters:

- **Filter by email** shows one person's changes. **Everyone** clears it.
- **Only failures** shows refused and failed entries among those loaded.

## Read it from the server's output

In web mode, every entry is also printed to stdout as one JSON line:

```json
{"audit":true,"at":"2026-11-17T09:30:12.345Z","user":"dana@example.com","ip":"10.0.0.12","method":"POST","path":"/api/k8s/deployments/web/scale","status":200}
```

Pick them out of the pod's log, or let your log pipeline keep them:

```bash
kubectl -n kubedeck logs deploy/kubedeck | grep '"audit":true'
```

When someone approves a change the assistant proposed, the server also prints a line before running it:

```text
[kubedeck:agent] running approved kubectl user="dana@example.com" thread=… context=dev command="…"
```

## Where it is stored

Entries live in the `audit_log` table of KubeDeck's database. Back it up with the rest of the database. See [Database](/web/database).

If the desktop app cannot open its database, it runs without an audit log, and the page says `The audit log is off: KubeDeck could not open its database.` Web mode does not start without its database.
