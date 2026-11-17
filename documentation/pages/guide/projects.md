---
title: "Projects"
description: "Group one application's namespaces across clusters and see its health, version drift, workloads and map in one place."
---

# Projects

A project is one application seen as one thing, even when it runs in several namespaces on several clusters. Say `payments` runs in `dev`, `staging` and `prod`. A project shows its health in all three, which versions differ, and what is failing where. Use projects for the applications you look after every day.

## Where projects are kept

Projects are stored by KubeDeck's server, in its database. They are never stored in your kubeconfig or in the cluster.

| | Desktop | Web |
|---|---|---|
| Where | KubeDeck's database on this computer | KubeDeck's database, shared |
| Who sees them | you | everyone signed in to this KubeDeck |
| Who changes or deletes one | you | its creator, or an admin |

What a person sees *inside* a project still follows their own cluster access. A project lists `prod/payments`, but someone who cannot read pods there gets an error on that place, not its data.

::: callout info
Older versions kept projects in the browser. The first time you open **Projects**, KubeDeck moves those to the server once and removes them from the browser.
:::

## Create a project

::: steps
::: step "Open Projects"
Click **Projects** near the bottom of the sidebar, then **New project**. On an empty page the button reads **Create your first project**.
::: /step
::: step "Name it"
Give it a **Name**, such as `Payments`, and an optional **Description**. The name becomes the project's address, for example `/projects/payments`.
::: /step
::: step "Add its namespaces"
Under **Namespaces**, pick a **Cluster**, then a **Namespace**, and press **Add**. Repeat for every place the application runs. The namespace in the scope switcher is added for you when you start, unless it is **All namespaces**.

A project needs at least one namespace. **All namespaces** cannot be added: pick real ones.
::: /step
::: step "Create it"
Press **Create project**. KubeDeck opens the new project.
::: /step
::: /steps

To change a project later, open it and press **Edit**. The bin icon deletes it, after asking **Delete this project for everyone?** If you cannot edit a project, its page says who created it instead.

## The project list

**Projects** shows a card per project with:

- a dot: green when all is healthy, red when something needs attention
- how many namespaces and clusters it spans
- its deployments and pods, and how many need attention
- the first places it runs, as `cluster/namespace`

Click a card to open the project.

## The project page

A project page has four tabs. All of them read the project's places live and refresh every 10 seconds.

### Overview

Four numbers first:

| Number | Meaning |
|---|---|
| **Deployments ready** | the share of the project's deployments with every replica ready, and `N of M` |
| **Pods running** | pods running or completed, out of all, and how many are failing |
| **Needs attention** | how many workloads have a problem |
| **Runs in** | how many namespaces, on how many clusters |

Then a card for each place, showing its cluster above its namespace, ready deployments, pod count and failing pods. A place that could not be read shows the error. Click a card to show only that place's problems. Click it again to show every place.

**Needs attention** lists problems grouped by workload. A crashing pod and its deployment at `0/1` are one row, not two. Each row shows:

- the workload, its kind, and how many of its pods are failing
- the problem, such as `CrashLoopBackOff` or `1/3 ready`
- every place where it happens

The most widespread problems come first. Expand a row to see each place, with links to the deployment and to each failing pod.

### Compare

**Compare** puts every deployment against every place: one row per deployment, one column per `cluster/namespace`. Each cell shows the ready count and the image tag.

- A tag in amber differs from what most places run. The row is marked **versions differ**.
- `—` means the deployment does not exist there. The row is marked **not everywhere**.
- A ready count in red means not every replica is ready.

Filter with **All**, **Differ** or **Unhealthy**, or type in **Find a deployment**. Click a cell to open that deployment in that place.

For the tag, KubeDeck takes the part after the last `:` of the image. An image pinned by digest shows the digest's first 12 characters. An image with no tag shows `latest`.

### Workloads

A table of every deployment in every place: **Deployment**, **Where**, **Status** (**Ready** or **Degraded**), **Ready**, **Image** and **Age**. It filters and sorts like any other list. Click a name to open it.

### Map

The [namespace map](/guide/map) for one of the project's places. With more than one place, buttons above the map switch between them.

## Permissions in web mode

Creating and changing projects needs the KubeDeck permission **Create and edit projects**. An admin turns it on per group in **Settings → Groups** (see [Permissions](/web/permissions)).

- Without it, projects are view only. **New project** and **Edit** are not shown, and the server refuses changes.
- With it, you can create projects, and change or delete the ones you created.
- Admins have every permission, and can change or delete any project.

Projects do not touch a cluster. They can still be created and edited when the shared KubeDeck runs read-only (`KUBEDECK_READ_ONLY=true`).
