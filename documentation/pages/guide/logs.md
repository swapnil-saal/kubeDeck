---
title: "Logs"
description: "Stream a pod's or a whole workload's logs, filter them down to the lines that matter, and know where log history comes from."
---

# Logs

KubeDeck streams container logs live, from one pod or from every pod of a workload at once. The log explorer parses each line, so you can filter by level, phrase or field, hide noise such as health checks, and jump between matches. Use it when you are chasing a crash or a failing request and `kubectl logs | grep` is not enough.

## Open logs

- In the pod list, **Logs** is the first button on each row.
- In the deployment list, **Logs** opens the combined logs of all its pods.
- In the pod list's **By workload** view, **Logs (N pods)** does the same for any workload.
- On the Overview, pod rows in **Needs attention** have a **Logs** button.
- On a resource's page, open the **Logs** tab.

These kinds have a **Logs** tab: pods, deployments, StatefulSets, DaemonSets, ReplicaSets, jobs and services. For a workload or a service, KubeDeck finds its pods from the selector.

## The toolbar

A status pill shows where the stream is:

| Status | Meaning |
|---|---|
| **Live** | following new lines |
| **Paused** | you paused the view; the stream keeps collecting and shows `+N` new lines |
| **Snapshot** | a one-off read that has ended, such as a crashed container's previous logs |
| **Connecting…** / **Disconnected** | starting, or the connection dropped (press **Reconnect**) |

Then, from left to right:

- **Pods** (workloads only): `All N pods`, or the ones you picked. Choose **All**, **None**, or **only** next to one pod. Each pod's lines get their own colour.
- **Container**: shown when the pod has more than one. **All containers** by default.
- **Time range**: **Latest lines**, **Last 5 min**, **Last 15 min**, **Last hour**, **Last 6 hours** or **Last 24 hours**.
- **Lines to load per container**: 200, 500, 1,000, 2,000 or 5,000. The default is 500.
- **Previous**: the logs of the previous, crashed container instead of the current one. These cannot be followed.
- **All pods of `<deployment>`**: on a pod that a deployment owns, jumps to the deployment's combined logs.
- **Pause** / **Resume**, and the reload button.
- **Summarize**: asks the assistant what is going on in these lines. Shown only when the assistant is on.
- **View options**: line format (**auto**, **pretty** or **raw**), **Wrap long lines**, **Compact toolbar**, **Show timestamps**.
- **Focus**: the logs take the whole window. Press `Esc` to leave.
- Copy, download, and clear: copy and download take the lines you can see.

## Workload logs

For a workload, KubeDeck streams its newest pods first. It streams at most 12 pods and 24 containers at a time. The pod chooser says how many older pods are not streamed.

While following, KubeDeck keeps looking for new pods. During a rollout, the new pods' lines appear as they start.

## Filter lines

Type in the **Filter** box. Words are ANDed.

| Query | Keeps |
|---|---|
| `timeout` | lines containing "timeout", ignoring case |
| `timeout -healthcheck` | the same, without health-check lines |
| `"request served"` | an exact phrase |
| `level:error,warn` | only errors and warnings |
| `pod:5584d` | one replica, by part of its pod name |
| `/user\d+ (failed\|denied)/` | a regular expression |

Next to the box:

- `.*` treats every term as a regular expression.
- `Aa` matches case.
- **Context lines** shows ±2, ±5 or ±10 lines around each match.
- `Enter` and `Shift+Enter` jump to the next and previous match.

The question mark button shows these examples; click one to use it. The filter is kept in the page's URL, so you can share a link to a filtered view.

### Levels and fields

KubeDeck reads JSON, logfmt and klog lines, and finds the level in plain text lines that use upper-case level words such as `ERROR` or `WARN`.

- The **Error**, **Warn**, **Info** and **Debug** chips show how many lines have each level. Click them to keep only those levels.
- On a structured line, click a field chip to filter to that value. `Shift`-click it to hide that value instead.

### Hide noise

- **Hide…**, next to the level chips, takes a pattern to hide: plain text, or `/regex/`. Patterns are remembered per workload in this browser, so a hidden `/healthcheck` stays hidden next time.
- KubeDeck spots lines that repeat constantly or look like health checks or probes, and offers to hide them. Choose **Hide them** or **Not now**.
- The `N hidden` chip shows the hidden lines for a moment. Click it again to hide them again.
- **N distinct problems** lists the different errors in view. Pick one to filter to it.

## Log history and Loki

The log explorer reads through `kubectl logs`. It can only show what the cluster still keeps for pods that exist now.

With the **Loki logs** plugin on, two more things are possible:

- On a trace, the pod's log lines from the moment of the request sit next to the span. See [Traces](/guide/traces).
- The assistant can read log history from Loki, including pods that are gone.

Set it up in [Grafana Loki](/integrations/loki).

## Web mode

Logs work the same in web mode. You see the logs your account may read: the cluster refuses `pods/log` where your RBAC does not allow it. **Summarize** is hidden when the assistant is off for you.
