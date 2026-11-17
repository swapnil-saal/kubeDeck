# Tests

Every test lives here, in a tree that mirrors the code:

| Folder | Tests for |
| --- | --- |
| `tests/server/…` | `server/…` (routes over real HTTP, modules against a real SQLite database) |
| `tests/client/…` | `client/src/…` (pure logic of pages, hooks and components) |
| `tests/shared/…` | `shared/…` |
| `tests/architecture.test.ts` | the architecture rules (gateways, front doors, table owners) |
| `tests/support/` | helpers: `memoryDatabase()`, `listen(app)`, `unreachableKubeconfig()` |

Tests import through aliases, never relative paths: `@server/groups`, `@/lib/projects` (client/src),
`@shared/groups`, and helpers from `@tests/support/db`.

```sh
npm test                          # everything
npx vitest run tests/server/groups
npm run check:arch                # only the architecture rules
```

Tests run against real code: no mocked clusters or language models. A test that needs a cluster
address uses `unreachableKubeconfig()`, which fails fast.
