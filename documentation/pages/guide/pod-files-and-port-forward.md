---
title: "Pod files and port-forward"
description: "Browse, search and download files inside a running container, and forward a pod's port to your machine from the desktop app."
---

# Pod files and port-forward

Two ways to reach inside a running pod without a terminal. **Pod files** lets you browse, search and download a container's files. **Port-forward** opens a pod's port on your own machine, so you can call the app from your browser or tools. Pod files work in both modes; port-forward exists in the desktop app only.

## Pod files

Open a pod and select the **Files** tab. KubeDeck starts in the container's working directory. Pick another container from the **Container** menu.

You can:

- **Browse** folders in a tree. A folder shows at most its first 2,000 entries.
- **Read** a text file. Large files show their first 512 KB. **Copy** copies the text; **Download** saves the file.
- **Search** under the current folder, by **Text** (a fixed string in file contents) or by **File names**. Dependency and VCS folders (`node_modules`, `.git`, `vendor`, `__pycache__`, `.venv`) are skipped unless you tick **Include dependencies**. `/`, `/proc`, `/sys` and `/dev` cannot be searched: pick a folder below them.
- **Download** a file as it is, or a folder as `<folder>.tar.gz`. Use the download button on a row, or **Download folder** for the folder you are in.

Pod files only read. Nothing in the container is changed.

### How it works and what it needs

KubeDeck runs `kubectl exec` with a fixed, read-only script inside the container. Your path and search text are passed to the script as arguments, never as shell code. The files are read as the container's user.

| Needs | Why |
|---|---|
| Permission to exec into the pod (RBAC `create` on `pods/exec`) | The **Files** tab is hidden when you do not have it |
| `sh`, `ls`, `head`, `grep` and `find` in the image | A distroless or scratch image has none, so its files cannot be browsed |
| `tar` with gzip in the image | Only for downloading folders. Single files download without it |

KubeDeck explains a failure in plain words, for example a container without a shell or a path that does not exist.

### In web mode

Pod files run as you, so your cluster permissions decide which pods you can exec into. Two more switches apply:

| Switch | Where | Effect |
|---|---|---|
| `KUBEDECK_POD_FILES=off` | The server's environment | Turns pod files off for everyone. The default is on |
| **Pod files** | KubeDeck permission per group, in **Settings → Groups** | Without it, the **Files** tab is hidden and the server refuses file requests. Admins always have it |

See [Permissions](/web/permissions) and [Configuration](/web/configuration).

## Port-forward

::: callout info title:"Desktop only"
A shared web KubeDeck has no port-forward: the port would open inside the server, not on your machine. The menu entry is hidden and the server refuses the request.
:::

::: steps
::: step "Open the pod's actions"
In the **Pods** list, open the pod's actions menu and select **Port forward…**.
::: /step
::: step "Choose the ports"
Enter the **local port** on your machine and the **pod port** the app listens on. If the pod declares container ports, pick one from **Ports the pod declares**. If it declares none, type the port.
::: /step
::: step "Start the forward"
Select **Forward localhost:&lt;port&gt;**. KubeDeck runs `kubectl port-forward` with your kubeconfig and waits for kubectl to confirm.
::: /step
::: /steps

Active forwards appear in a **Forwards** bar at the bottom of every page, as `:<local port> → <pod>:<pod port>`.

- Click the local port to open `http://localhost:<port>` in your browser.
- Hover a forward to see how many connections it handled, or why it failed.
- A forward whose kubectl process ended is marked **DEAD**.
- The stop button ends the forward.

Each local port can be used by one forward at a time. Forwards keep running while you move around KubeDeck.
