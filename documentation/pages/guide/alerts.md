---
title: "Alerts"
description: "Get told when a pod or deployment newly breaks in the namespace you are watching, through the header bell, desktop notifications and a sound."
---

# Alerts

KubeDeck watches the cluster and namespace selected in the header and tells you when something newly breaks there: a pod that starts crash-looping, an image that cannot be pulled, a deployment that loses ready replicas. Alerts appear in the bell in the header and, when the window is in the background, as a desktop notification.

## What triggers an alert

KubeDeck compares each refresh of the pod and deployment lists with the previous one. It needs no extra requests and no setup.

| Alert | Severity | When |
|---|---|---|
| Pod crash: `CrashLoopBackOff`, `Error`, `OOMKilled`, `RunContainerError`, `CreateContainerError`, `CreateContainerConfigError`, `ContainerCannotRun`, `StartError` | Failure | At once |
| Image problem: `ImagePullBackOff`, `ErrImagePull`, `InvalidImageName`, `ErrImageNeverPull` | Failure | At once |
| Pod `Failed`, `Unknown`, `Evicted` or `NodeLost` | Failure | At once |
| Pod stuck in `Pending`, `ContainerCreating`, `PodInitializing` or an `Init:` state | Warning | After it persists for a grace period |
| Pod `Running` with containers not ready | Warning | After the grace period |
| Deployment with fewer ready replicas than desired | Failure when none are ready, warning otherwise | After the grace period |
| Pod restarted since the last refresh | Warning | Rate-limited per pod |
| Deployment healthy again | Info | Only when **Tell me when deployments recover** is on |

The grace period keeps an ordinary rollout quiet: a pod that is `Pending` for a few seconds is not a problem.

### What is not announced

- **What was already broken.** When you open a namespace, or switch to another one, KubeDeck takes what is broken there as the starting point and only alerts on what breaks after that.
- **Repeats.** A resource alerts once until it recovers. If it recovers and breaks again soon after, it stays quiet for a cooldown, unless it gets worse.
- **Bursts.** When more than three problems arrive at once, you get one notification ("N new problems in shop") instead of many. Each one still appears in the bell.

## Scope

Alerts cover only the context and namespace selected in the header, and only while KubeDeck is open. Switch namespace and the watcher follows. With **all namespaces** selected, it watches pods and deployments across all namespaces.

In web mode the watching happens in your browser, so alerts only run while a KubeDeck tab is open. Each person gets their own alerts.

## The bell

The bell in the header shows the number of unread alerts. Open it to see recent alerts, newest first, each with the resource, the namespace or reason, the context and how long ago. Alerts are marked read shortly after you open the list.

Click an alert to go to the resource. For a pod, KubeDeck opens its logs. The trash icon clears the list.

The list is kept in this browser and survives a restart. Only the most recent alerts are kept.

## Settings

The settings are at the bottom of the bell's popover. They are saved in this browser only.

| Setting | Default | Meaning |
|---|---|---|
| **Alert me about new failures** | On | Turns alerts off completely. The bell shows a crossed-out icon |
| **Desktop notifications** | On, once you allow notifications | System notifications when the KubeDeck window is not in front. Turning it on asks for the notification permission |
| **Play a sound** | On | A short chime with each alert, lower for failures. **Test** plays it |
| **Interrupt me for** | warnings and failures | Choose **failures only** to drop warnings. Dropped alerts do not appear in the bell either |
| **Tell me when deployments recover** | Off | An info alert when a failing deployment is healthy again |

When the window is in front, alerts show as a toast inside KubeDeck instead of a system notification. Click the toast or the notification to open the resource.

::: callout tip title:"Notifications blocked"
If your operating system blocks notifications for KubeDeck, the bell says so and the switch is disabled. Allow notifications for KubeDeck (or your browser) in the system settings, then turn the switch on.
:::
