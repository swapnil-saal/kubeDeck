---
title: "AI providers"
description: "Connect Ask Deck and the other AI features to OpenAI, Anthropic, Ollama or any OpenAI-compatible gateway, and know what data goes to that provider."
---

# AI providers

KubeDeck's AI features (Ask Deck, diagnose and explain, summaries, and plain-English commands in the kubectl palette) all use one model provider. You choose it once, under **Settings → AI assistant**. KubeDeck ships no model of its own, so nothing AI-related works until a provider is set.

## Supported providers

| Provider | Setting value | API key | Endpoint |
| --- | --- | --- | --- |
| OpenAI | `openai` | Required | Optional. Empty uses `https://api.openai.com/v1` |
| Anthropic | `anthropic` | Required | Optional. Empty uses `https://api.anthropic.com/v1` (a URL without `/v1` gets it added) |
| Ollama | `ollama` | Not needed | Optional. Empty uses `http://localhost:11434` |
| OpenAI-compatible | `custom` | Optional, if your gateway needs one | Required, e.g. `https://gateway.example.com/v1` |

Use **OpenAI-compatible** for vLLM, LiteLLM or any gateway that speaks the OpenAI chat API.

::: callout info title:"Ollama in web mode"
The endpoint is reached from the KubeDeck server, not from the browser. On a shared KubeDeck, `localhost` is the KubeDeck pod. Point the endpoint at an address the server can reach.
:::

## Set the provider

::: steps
::: step "Open Settings → AI assistant"
On the desktop you can always open it. In web mode only a KubeDeck admin sees this page; other people see a note that the AI provider is set up by the admins.
::: /step
::: step "Pick the provider"
Choose OpenAI, Anthropic, Ollama or OpenAI-compatible. KubeDeck fills in a suggested model and fast model.
::: /step
::: step "Fill in the connection"
Type the API key and, where needed, the endpoint.
::: /step
::: step "Choose the models"
Pick from the suggestions or type any model id your provider serves.
::: /step
::: step "Save, then Test connection"
**Test connection** sends one tiny request to the model and shows the model that answered, or the provider's error. Save first: the button is disabled while you have unsaved changes.
::: /step
::: /steps

In web mode, saving applies to everyone on that KubeDeck.

## Model and fast model

| Field | Used for | When empty |
| --- | --- | --- |
| **Model** | Ask Deck and the larger AI tasks | The provider's default model |
| **Fast model** | Short tasks: summaries, status hints, command translation | The provider's default small model |

The defaults KubeDeck uses when a field is empty:

| Provider | Model | Fast model |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` | `gpt-4o-mini` |
| Anthropic | `claude-sonnet-5-5` | `claude-haiku-5-5` |
| Ollama | `llama3.2` | `qwen3.5:0.8b` |
| OpenAI-compatible | none: set a model | none |

The page notes that quick features (event summaries, status hints) turn on once a fast model is set.

## How the API key is stored

The provider settings are kept like a plugin, with the id `ai` (`server/ai/ai-plugin.ts`). It is always on and does not appear on the Plugins page.

- The API key is encrypted at rest and never sent back to the browser. The page shows "stored encrypted"; type a new key to replace it, or leave the field empty to keep the stored one.
- The settings live in KubeDeck's database. See [Plugins](/integrations/plugins) for how secrets are encrypted.
- On the desktop, AI settings from an older `~/.kubedeck/settings.json` are moved into the database once, the first time the new version starts.

## Pin the provider with environment variables

On a server, you can set the provider through the environment instead of the page. Each variable that is set pins its field: the page shows it as "Set by the server's environment" and nobody can change it there. Fields you leave unset stay editable by an admin.

| Variable | Field |
| --- | --- |
| `KUBEDECK_AI_PROVIDER` | Provider: `openai`, `anthropic`, `ollama` or `custom` |
| `KUBEDECK_AI_API_KEY` | API key |
| `KUBEDECK_AI_MODEL` | Model |
| `KUBEDECK_AI_FAST_MODEL` | Fast model |
| `KUBEDECK_AI_BASE_URL` | Endpoint |

```yaml
env:
  - { name: KUBEDECK_AI_PROVIDER, value: anthropic }
  - name: KUBEDECK_AI_API_KEY
    valueFrom: { secretKeyRef: { name: kubedeck, key: ai-api-key } }
```

An unknown provider value falls back to `openai`.

## Turn AI off

In web mode, set `KUBEDECK_AI=off` (also `0`, `false` or `no`). Every `/api/ai` request is then refused with "The AI assistant is turned off on this KubeDeck", and the AI features are hidden. With AI off, issues on the home screen open the pod or deployment instead of asking the assistant.

You can also leave AI on and take it away from some people: the **Ask Deck (assistant)** and **Assistant may propose changes** permissions of a group decide who may use it. See [Permissions](/web/permissions).

The desktop app has no off switch: without a provider, the AI features answer with an error that says what to set.

## What goes to the provider

::: callout warning title:"Cluster data leaves your network"
When you use an AI feature, KubeDeck sends your question and the cluster data the feature works with to the provider you chose. For Ask Deck that includes the output of the commands it runs: resource lists, YAML, events, logs, and traces or log history when those plugins are on. KubeDeck does not filter that output before sending it.
:::

What limits this:

- The assistant reads only what the person may read. In web mode it acts as the signed-in person, so their RBAC applies. See [Groups and cluster access](/web/groups).
- A self-hosted model (Ollama, or an OpenAI-compatible gateway in your network) keeps the data inside your network.
- Chat history stays in the browser (IndexedDB on that device). The KubeDeck server keeps none.

## When something fails

KubeDeck turns provider errors into a message that says what to fix:

| Message starts with | Usually means |
| --- | --- |
| "The AI provider rejected the API key" | Wrong or expired key (HTTP 401 or 403) |
| "The AI model was not found" | The model id is not served by that provider |
| "The AI provider is unavailable (503)" | The gateway has no healthy backend; check the endpoint and model |
| "Could not reach the AI provider" | Wrong endpoint, or the server cannot reach it |
| "The request is larger than the model's context window" | Ask a shorter question or use a model with a larger context |

## Related

- [Ask Deck (assistant)](/guide/assistant)
- [MCP servers](/integrations/mcp-servers): more tools for the assistant
- [Environment variables](/reference/environment-variables)
