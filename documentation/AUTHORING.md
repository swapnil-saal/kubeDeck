# Writing KubeDeck's documentation

The site is built with [docmd](https://docs.docmd.io) from `documentation/pages/` and served by KubeDeck at `/docs`.

```sh
npm run docs:dev     # live preview on http://localhost:3000
npm run docs:build   # build into dist/docs (npm run build does this too)
```

The sidebar is `navigation` in `docmd.config.json`: a new page needs an entry there.

## Every page

- File: `pages/<section>/<slug>.md`, matching its `path` in the navigation (`/guide/logs` → `pages/guide/logs.md`).
- Front-matter, then ONE `#` heading equal to the title:

  ```markdown
  ---
  title: "Logs"
  description: "One sentence: what the reader can do after reading this page."
  ---

  # Logs
  ```

- First paragraph = what this is and why you would use it, in two or three sentences. Then sections (`##`) in the order a reader needs them.

## Voice

- Write for an engineer who runs Kubernetes and has never seen KubeDeck. Plain words, short sentences (under 25 words), second person ("you").
- Specific, not vague: name the screen, the button, the setting, the environment variable, the default.
- Only what KubeDeck does today: check every claim in the code (`client/src`, `server`, `shared`, `docs/`, `deploy/`). A feature you cannot find does not go in. Never invent numbers, limits or flags.
- Say which mode a feature exists in when it differs: **Desktop** (Electron app, your own kubeconfig) or **Web** (shared server, sign-in, groups).
- No company or cluster names from anyone's real setup. Examples use `dev`, `staging`, `prod`, namespaces like `shop`, `payments`, emails `@example.com`.
- No emoji, no marketing adjectives ("blazing", "seamless", "powerful").

## Formatting (docmd containers)

```markdown
::: callout tip
Short advice.
:::

::: callout warning title:"Read-only clusters"
Something that can go wrong.
:::

::: steps
::: step "Download the app"
Text.
::: /step
::: step "Open your kubeconfig"
Text.
::: /step
::: /steps

::: tabs
::: tab "macOS"
Text.
::: /tab
::: tab "Linux"
Text.
::: /tab
::: /tabs

::: card title:"Groups" icon:users
Text and a [link](/web/groups).
::: /card
```

Callout types: `info`, `tip`, `warning`, `danger`, `success`. Icons are [Lucide](https://lucide.dev/icons) names.

- Tables for settings, variables, permissions (name, default, meaning).
- Code blocks always have a language: `bash`, `yaml`, `json`, `text`.
- Links between pages: absolute paths without the base, e.g. `[Groups](/web/groups)`.
- A diagram, when a flow really needs one: a ```mermaid block (keep it small).
