---
title: "kubectl palette"
description: "Run kubectl from anywhere in KubeDeck with ⌘K, type what you want in plain English, and know which commands run, ask first or are refused."
---

# kubectl palette

The kubectl palette is a command bar you open from any page with **⌘K** (**Ctrl+K** on Windows and Linux). Paste a kubectl command, type part of a resource name, or describe what you want in plain English. KubeDeck runs the command for the cluster and namespace you have selected and shows the output in the palette.

## Open and close it

- Press **⌘K** / **Ctrl+K** to open the palette. Press it again to close it.
- Press **Esc** to close it. If command output is showing, the first **Esc** closes the output.
- The strip under the input shows the selected context and namespace. You can switch the namespace there without leaving the palette.

## What you can type

| You type | What the palette shows |
|---|---|
| A kubectl command, with or without `kubectl` in front | The command, ready to run |
| Part of a resource name | Matching pods, deployments and services in the selected scope, with a command for each |
| A common request such as `show me crashing pods` or `top pods by cpu` | Commands that KubeDeck builds from its own patterns, without any AI |
| Anything else in plain English | A kubectl command written by the AI model, when AI is set up |

Every suggested command is editable. Change it in place, then select **Run** or press **Enter** in the command box. **Copy** puts the command on your clipboard.

With an empty input, the palette lists suggestions for the selected scope (for example logs of a failing pod, recent events, or top pods by CPU) and your **Recent** commands. Recent commands are kept per context and namespace, in this browser only.

### Plain English with AI

When an AI provider is configured, text that does not start with a kubectl verb and matches nothing else is sent to the model after a short pause. The model returns one kubectl command and a one-line explanation, shown as an **AI** suggestion. When the palette already has pattern matches, an **AI Translate** button lets you ask the model anyway.

The model gets your request, the selected context and namespace, and the names of resources KubeDeck already loaded, so it uses real names. Translation uses the fast model from your AI settings. The suggestion is labelled before you run it:

- **Changes the cluster:** the command writes, and KubeDeck will ask you to confirm.
- **KubeDeck won't run this (destructive):** the command is blocked (see below).

**Ask AI** in the scope strip opens [Ask Deck](/guide/assistant) with what you typed.

To set up a provider, see [AI providers](/integrations/ai-providers).

### Interactive commands

Commands that need a terminal (`exec`, `logs -f`, `port-forward`, `attach`, `run … --stdin`) are marked **interactive**. The palette does not run them; copy them into your terminal instead.

## What runs, what asks, what is refused

The server classifies every command before it runs it. The palette and Ask Deck use the same rules.

| Level | Commands | What happens |
|---|---|---|
| Runs | `get`, `describe`, `logs`, `top`, `explain`, `api-resources`, `api-versions`, `version`, `auth`, `cluster-info`, `diff`, `events`, `wait`, `rollout status`, `rollout history`, `config view`, `config get-contexts`, `config current-context` | Runs at once |
| Asks first | Everything else, for example `scale`, `apply`, `rollout restart`, `label`, `edit`, `patch` | The palette shows a warning and the command. Nothing runs until you confirm |
| Refused | `delete`, `drain`, `cordon`, `uncordon`, `taint` | Never runs from the palette, even with confirmation. Use the KubeDeck UI or your terminal |

### Pipes (desktop only)

On the desktop you can pipe kubectl into text filters, for example:

```bash
kubectl get pods --no-headers | awk '{print $3}' | sort | uniq -c
```

Only `kubectl` and these filters are allowed: `jq`, `grep`, `awk`, `sed`, `sort`, `head`, `tail`, `wc`, `cut`, `uniq`, `tr`, `echo`, `date`, `column`. The palette refuses a line that runs any other program, uses `$( )` or backticks, writes to a file, or gives a filter a file path to read. The most dangerous command in the line decides whether it runs, asks or is refused.

## In web mode

On a shared KubeDeck the palette runs kubectl as you, so the cluster's RBAC decides what you can see and change. It also refuses anything that would let you step outside your own identity.

| Refused | Why |
|---|---|
| Verbs `config`, `auth`, `exec`, `cp`, `port-forward`, `proxy`, `attach`, `debug` | They would expose the server's credentials or give a shell under its identity |
| Flags `--kubeconfig`, `--token`, `--server` (`-s`), `--as`, `--as-group`, `--as-uid`, `--client-certificate`, `--client-key`, `--certificate-authority`, `--insecure-skip-tls-verify`, `--username`, `--password`, `--user`, `--cluster` | They would change who kubectl acts as, or which cluster credentials it uses |
| Pipes and any other shell syntax | Commands run without a shell on a shared server |

When the server runs with `KUBEDECK_READ_ONLY=true`, the palette runs read commands only.

Every command run from the palette is recorded in the [audit log](/web/audit-log), with the command and the person who ran it. The desktop app keeps the same log for its one local user.

### The "kubectl palette" permission

In web mode the palette is a KubeDeck permission that an admin grants per group in **Settings → Groups**. Without it, **⌘K** does nothing and the server refuses palette commands. Admins always have it. See [Permissions](/web/permissions) and [Groups and cluster access](/web/groups).

Plain-English translation calls the AI endpoints, so it also needs the **Ask Deck (assistant)** permission and AI to be on for the server.

::: callout tip
The palette refuses `delete` even with confirmation. To delete a resource, use its actions in KubeDeck, where the cluster's RBAC and the audit log still apply.
:::
