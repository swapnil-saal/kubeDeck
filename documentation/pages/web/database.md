---
title: "Database"
description: "Choose between SQLite and Postgres for web mode, point KubeDeck at it, and back it up."
---

# Database

Web mode keeps its accounts, sessions, clusters, groups, projects, plugin settings and audit log in one database. It can be a SQLite file, for a single KubeDeck pod, or Postgres, for several. KubeDeck creates and upgrades its tables itself on every start.

## Choose one

| | SQLite | Postgres |
|---|---|---|
| Replicas | Exactly one | One or more |
| Setting | `KUBEDECK_DATABASE_URL=sqlite:/data/kubedeck.db` | `KUBEDECK_DATABASE_URL=postgres://user:pass@host:5432/kubedeck` |
| Storage | A file on a volume | Your Postgres server |
| Manifest | As shipped: a 1Gi volume and the `Recreate` strategy | Remove the volume and `Recreate`, raise `replicas` |

SQLite uses Node's built-in `node:sqlite`, so the image needs no native add-on. KubeDeck opens it in WAL mode.

## Set the connection

`KUBEDECK_DATABASE_URL` takes one of:

| Form | Meaning |
|---|---|
| unset | SQLite at `~/.kubedeck/kubedeck.db`. |
| `sqlite:/path/to/file.db` | SQLite at that path. `sqlite:///path` works too. |
| `postgres://…` or `postgresql://…` | Postgres, with a standard connection string. |

Anything else stops the start with `KUBEDECK_DATABASE_URL must start with postgres:// or sqlite: (got "…").`

On start, the log names the database without its password, for example `database: sqlite /data/kubedeck.db` or `database: postgres db.example.com:5432/kubedeck`.

In Kubernetes, keep a Postgres connection string in a Secret. The manifest has a commented example:

```yaml
- name: KUBEDECK_DATABASE_URL
  valueFrom: { secretKeyRef: { name: kubedeck-db, key: url } }
```

::: callout warning title:"Set it in a container"
The default `~/.kubedeck/kubedeck.db` is inside the container. With a read-only root filesystem, KubeDeck cannot create that folder and stops: `Web mode cannot start without its database: cannot create … for the SQLite database (…). Point KUBEDECK_DATABASE_URL at a writable volume, e.g. sqlite:/data/kubedeck.db, or at Postgres (postgres://…).`
:::

## What is stored

| Data | Kept by |
|---|---|
| Accounts, passwords (hashed), sessions | The sign-in library, Better Auth, in its own tables |
| Clusters from **Settings → Clusters**, with KubeDeck's uploaded connection kubeconfigs encrypted | `kubedeck_cluster` |
| Groups and each group's cluster access, with uploaded kubeconfigs encrypted | `kubedeck_group`, `group_cluster_access` |
| Projects | `project` |
| Plugin and AI provider settings, with secrets encrypted | `plugin_state` |
| Audit log | `audit_log` |

KubeDeck's own migrations are tracked in `kubedeck_migration`. They run on every start and are safe to repeat.

Uploaded kubeconfigs and plugin secrets are encrypted with keys derived from `KUBEDECK_AUTH_SECRET`. A copy of the database alone does not reveal them, and a new secret cannot read them.

## Back up

- **SQLite:** snapshot the volume, or copy the files from `/data`. Copy `kubedeck.db` together with any `kubedeck.db-wal` next to it, since WAL mode keeps recent writes there.
- **Postgres:** back it up as you do your other databases.

Keep `KUBEDECK_AUTH_SECRET` with the backup. Without it, a restored database still has its accounts, but uploaded kubeconfigs (clusters' and groups') and plugin secrets must be entered again.

## The desktop app

The desktop app opens the same kind of database at `~/.kubedeck/kubedeck.db` for its audit log, projects and plugin settings. It has no accounts. If it cannot open the file, it starts anyway and logs `no audit log: could not open the database (…)`.
