/**
 * Architecture boundaries, checked on every `npm test` (on its own: `npm run check:arch`).
 *
 * The approved shape: only gateways reach outside, each module has one front door, and each module
 * owns its tables. This test parses every source file under server/, client/src/ and shared/ with
 * the TypeScript parser (imports, `export … from`, `import()`, `require()`, `typeof import()`) and
 * fails when code crosses a boundary.
 *
 * The allowlists below hold what the code does today, each with a reason. A new crossing fails with
 * the file, the import, the rule and what to do instead. Prefer fixing the code over growing a list;
 * when an exception is right, add it here with a reason that would convince a reviewer.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["server", "client/src", "shared"];
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.test\.tsx?$/;

// ---------------------------------------------------------------------------------------------
//  Rules and allowlists
// ---------------------------------------------------------------------------------------------

/** Paths ending in "/" are folders (everything under them); others are single files. */
type Scope = string;

interface PackageRule {
  what: string;
  matches: (pkg: string) => boolean;
  allowedIn: Scope[];
  fix: string;
}

/** Outside libraries that only their gateway module may load. */
const PACKAGE_RULES: PackageRule[] = [
  {
    what: "only server/auth may use Better Auth",
    matches: (p) => p === "better-auth",
    allowedIn: ["server/auth/"],
    fix: "call what server/auth exports (import from './auth' or '../auth'); add the function there if it is missing",
  },
  {
    what: "only server/db may use the database drivers (kysely, pg, node:sqlite)",
    matches: (p) => p === "kysely" || p === "pg" || p === "sqlite",
    allowedIn: ["server/db/"],
    fix: "take a `Database` from '../db' and query through it, or re-export the helper you need from server/db/index.ts",
  },
  {
    what: "only the MCP gateway may use @ai-sdk/mcp",
    matches: (p) => p === "@ai-sdk/mcp",
    allowedIn: ["server/grafana-mcp.ts", "server/mcp/"],
    fix: "go through server/grafana-mcp.ts (or the MCP hub under server/mcp/)",
  },
  {
    what: "only the assistant (server/ai, client/src/ai) may use the AI SDK core package `ai`",
    matches: (p) => p === "ai",
    allowedIn: ["server/ai/", "client/src/ai/"],
    fix: "move the code into server/ai (server) or client/src/ai (client), or call what those modules export",
  },
  {
    what: "only server/ai may use the AI SDK model providers (@ai-sdk/*)",
    matches: (p) => p.startsWith("@ai-sdk/") && p !== "@ai-sdk/mcp" && p !== "@ai-sdk/react",
    allowedIn: ["server/ai/"],
    fix: "get a model from server/ai/provider.ts instead of creating a provider",
  },
  {
    what: "only the client assistant (client/src/ai) may use @ai-sdk/react and @assistant-ui/*",
    matches: (p) => p === "@ai-sdk/react" || p.startsWith("@assistant-ui/"),
    allowedIn: ["client/src/ai/"],
    fix: "put the chat UI under client/src/ai and use what client/src/ai exports elsewhere",
  },
];

/**
 * Files allowed to start processes. Everything else goes through `spawnCommand` / `runKubectlRaw`
 * in server/kubectl-run.ts. Non-test files here must also pass every spawn through `asUser()`.
 */
const CHILD_PROCESS_ALLOWED: Record<string, string> = {
  "server/kubectl-run.ts": "the kubectl gateway (spawnCommand, runKubectlRaw)",
  "server/pod-files.ts": "streams files in and out of a container with kubectl exec + tar",
  "server/pod-files-routes.ts": "pipes a kubectl exec download straight into the HTTP response",
  "server/log-routes.ts": "follows `kubectl logs -f` into a live stream",
  "server/log-fetch.ts": "reads logs with `kubectl logs`",
  "server/port-forward-routes.ts": "keeps a `kubectl port-forward` process alive",
  "server/ai/chat/kubectl.ts": "the assistant's kubectl tool: argument arrays and pipelines, never a shell",
  "server/incluster.test.ts": "test: reads the generated kubeconfig back with kubectl",
};

const CHILD_PROCESS_FNS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]);

/** Modules with one front door: code outside the folder imports only its index. */
const FRONT_DOORS = ["server/auth", "server/db", "server/audit", "server/events", "server/ai/tools"];

/**
 * Imports that go past a front door today. Each should become a re-export from the module's index
 * (and the entry removed); do not add new ones without a reason.
 */
const FRONT_DOOR_EXCEPTIONS: { from: string; to: string; reason: string }[] = [
  {
    from: "server/index.ts",
    to: "server/auth/mount.ts",
    reason: "TODO: re-export mountAuthRoutes from server/auth/index.ts",
  },
  {
    from: "server/index.ts",
    to: "server/auth/admin-routes.ts",
    reason: "TODO: re-export registerAdminRoutes from server/auth/index.ts",
  },
];

/**
 * Who may read or write each table (Kysely `selectFrom/insertInto/updateTable/deleteFrom/...` with a
 * literal name). `null`: the table belongs to Better Auth, which is the only thing that touches it.
 */
const TABLE_OWNERS: Record<string, Scope | null> = {
  audit_log: "server/audit/",
  user: null,
  session: null,
  account: null,
  verification: null,
};

const TABLE_METHODS = new Set(["selectFrom", "insertInto", "updateTable", "deleteFrom", "replaceInto", "mergeInto"]);

// ---------------------------------------------------------------------------------------------
//  Scanner
// ---------------------------------------------------------------------------------------------

interface ImportRef {
  spec: string;
  line: number;
}
interface SpawnCall {
  fn: string;
  line: number;
  viaAsUser: boolean;
  shell: boolean;
}
interface TableRef {
  table: string;
  method: string;
  line: number;
}
interface SourceScan {
  imports: ImportRef[];
  spawns: SpawnCall[];
  tables: TableRef[];
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const isChildProcess = (spec: string | undefined) => spec?.replace(/^node:/, "") === "child_process";
const literalText = (n: ts.Node | undefined) => (n && ts.isStringLiteralLike(n) ? n.text : undefined);
const nameText = (n: ts.PropertyName | undefined) => (n && (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) ? n.text : undefined);

/** The module named by `import("x")` / `require("x")`, awaited or not. */
function loadedModule(e: ts.Expression | undefined): string | undefined {
  if (e && ts.isAwaitExpression(e)) e = e.expression;
  if (!e || !ts.isCallExpression(e)) return undefined;
  const isLoader = e.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e.expression) && e.expression.text === "require");
  return isLoader ? literalText(e.arguments[0]) : undefined;
}

/** The module an import-like node loads: import/export … from, import = require, typeof import(), import(), require(). */
function moduleSpecOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return literalText(node.moduleSpecifier);
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) return literalText(node.moduleReference.expression);
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return literalText(node.argument.literal);
  if (ts.isCallExpression(node)) return loadedModule(node);
  return undefined;
}

/** Local names bound to child_process: its functions (`spawn`, `execFile as run`) and the whole module (`cp`). */
class ChildProcessNames {
  readonly fns = new Map<string, string>();
  readonly modules = new Set<string>();

  get any() {
    return this.fns.size > 0 || this.modules.size > 0;
  }

  /** `import … from "child_process"` and `const … = (await) import/require("child_process")` */
  bind(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause && isChildProcess(literalText(node.moduleSpecifier))) {
      this.bindClause(node.importClause);
    } else if (ts.isVariableDeclaration(node) && isChildProcess(loadedModule(node.initializer))) {
      this.bindPattern(node.name);
    }
  }

  private bindClause(clause: ts.ImportClause) {
    if (clause.name) this.modules.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) this.modules.add(nb.name.text);
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) this.fns.set(el.name.text, (el.propertyName ?? el.name).text);
  }

  private bindPattern(name: ts.BindingName) {
    if (ts.isIdentifier(name)) return void this.modules.add(name.text);
    if (!ts.isObjectBindingPattern(name)) return;
    for (const el of name.elements) {
      if (ts.isIdentifier(el.name)) this.fns.set(el.name.text, nameText(el.propertyName) ?? el.name.text);
    }
  }

  /** The child_process function a callee refers to, if any. */
  fnOf(callee: ts.Expression): string | undefined {
    if (ts.isIdentifier(callee)) return this.fns.get(callee.text);
    const onModule = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && this.modules.has(callee.expression.text);
    return onModule && CHILD_PROCESS_FNS.has(callee.name.text) ? callee.name.text : undefined;
  }
}

function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/** `db.selectFrom("audit_log as a")` → { table: "audit_log", method: "selectFrom" } */
function tableRefOf(node: ts.Node): Omit<TableRef, "line"> | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const method = node.expression.name.text;
  const name = literalText(node.arguments[0]);
  if (!TABLE_METHODS.has(method) || name === undefined) return undefined;
  return { table: name.split(/\s+as\s+/i)[0].trim().split(".").pop() ?? "", method };
}

const isAsUserCall = (n: ts.Expression | undefined) => !!n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "asUser";

/** An options object with `shell` set to anything but `false`. */
const usesShell = (args: readonly ts.Expression[]) =>
  args.some(
    (a) =>
      ts.isObjectLiteralExpression(a) &&
      a.properties.some((p) => ts.isPropertyAssignment(p) && nameText(p.name) === "shell" && p.initializer.kind !== ts.SyntaxKind.FalseKeyword),
  );

/** Imports, process spawns and table accesses of one source file. */
function scanSource(file: string, text: string): SourceScan {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const scan: SourceScan = { imports: [], spawns: [], tables: [] };
  const cp = new ChildProcessNames();

  walk(sf, (node) => {
    const spec = moduleSpecOf(node);
    if (spec !== undefined) scan.imports.push({ spec, line: lineOf(node) });
    const table = tableRefOf(node);
    if (table) scan.tables.push({ ...table, line: lineOf(node) });
    cp.bind(node);
  });
  if (!cp.any) return scan;

  walk(sf, (node) => {
    const fn = ts.isCallExpression(node) ? cp.fnOf(node.expression) : undefined;
    if (!fn || !ts.isCallExpression(node)) return;
    const shell = fn === "exec" || fn === "execSync" || usesShell(node.arguments);
    scan.spawns.push({ fn, line: lineOf(node), viaAsUser: isAsUserCall(node.arguments[1]), shell });
  });
  return scan;
}

function listSources(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") out.push(...listSources(rel));
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

/** Repo-relative path a local specifier points at, or null for a package. */
function resolveLocal(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.posix.join("client/src", spec.slice(2));
  else if (spec.startsWith("@shared/")) base = path.posix.join("shared", spec.slice("@shared/".length));
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), spec);
  else return null;
  base = path.posix.normalize(base);
  const stems = [base, base.replace(/\.(m|c)?jsx?$/, "")];
  for (const stem of stems) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = stem + suffix;
      const abs = path.join(ROOT, candidate);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
    }
  }
  return base;
}

/** npm package (or Node builtin, without `node:`) a bare specifier loads. */
function packageOf(spec: string): string {
  const s = spec.replace(/^node:/, "");
  const parts = s.split("/");
  return s.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const within = (file: string, scope: Scope) => (scope.endsWith("/") ? file.startsWith(scope) : file === scope);

function regionOf(file: string): "client" | "server" | "shared" | "other" {
  if (file.startsWith("client/")) return "client";
  if (file.startsWith("server/")) return "server";
  if (file.startsWith("shared/")) return "shared";
  return "other";
}

interface ScannedFile extends SourceScan {
  file: string;
  /** every import, with its resolved target (local) or package name */
  refs: (ImportRef & { target: string | null; pkg: string | null })[];
}

const scanned: ScannedFile[] = SCAN_DIRS.flatMap((dir) => listSources(dir)).map((file) => {
  const s = scanSource(file, fs.readFileSync(path.join(ROOT, file), "utf-8"));
  const refs = s.imports.map((i) => {
    const target = resolveLocal(file, i.spec);
    return { ...i, target, pkg: target === null ? packageOf(i.spec) : null };
  });
  return { ...s, file, refs };
});

function expectNone(rule: string, violations: string[]) {
  if (violations.length === 0) return;
  throw new Error(`${violations.length} architecture violation(s): ${rule}\n\n${violations.join("\n\n")}\n\n(rules and allowlists: server/architecture.test.ts)`);
}

// ---------------------------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------------------------

describe("architecture scanner", () => {
  it("finds every kind of import", () => {
    const src = [
      'import a from "a";',
      'import type { B } from "b";',
      "import {",
      "  c,",
      '} from "c";',
      'export * from "d";',
      'export { e } from "e";',
      'const f = await import("f");',
      'const g = require("g");',
      'type H = typeof import("h");',
      'import i = require("i");',
    ].join("\n");
    expect(scanSource("x.ts", src).imports.map((i) => i.spec)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
  });

  it("sees process spawns and whether they go through asUser", () => {
    const src = [
      'import { spawn, execFile as run } from "node:child_process";',
      'spawn("kubectl", asUser("kubectl", args));',
      'run("kubectl", args);',
      "async function later() {",
      '  const cp = await import("child_process");',
      '  cp.spawn("sh", ["-c", x], { shell: true });',
      "}",
    ].join("\n");
    expect(scanSource("x.ts", src).spawns).toEqual([
      { fn: "spawn", line: 2, viaAsUser: true, shell: false },
      { fn: "execFile", line: 3, viaAsUser: false, shell: false },
      { fn: "spawn", line: 6, viaAsUser: false, shell: true },
    ]);
  });

  it("reads table names from Kysely calls", () => {
    const src = 'await db.selectFrom("audit_log as a").selectAll().execute(); await d.db.insertInto("public.user").values(v);';
    expect(scanSource("x.ts", src).tables.map((t) => `${t.method}:${t.table}`)).toEqual(["selectFrom:audit_log", "insertInto:user"]);
  });

  it("resolves relative paths and the @/ and @shared/ aliases", () => {
    expect(resolveLocal("server/index.ts", "./db")).toBe("server/db/index.ts");
    expect(resolveLocal("server/auth/index.ts", "../db")).toBe("server/db/index.ts");
    expect(resolveLocal("client/src/App.tsx", "@shared/routes")).toBe("shared/routes.ts");
    expect(resolveLocal("server/index.ts", "kysely")).toBeNull();
    expect(packageOf("@ai-sdk/openai/internal")).toBe("@ai-sdk/openai");
    expect(packageOf("node:child_process")).toBe("child_process");
  });

  it("scans the real source tree", () => {
    expect(scanned.length).toBeGreaterThan(100);
    const auth = scanned.find((f) => f.file === "server/auth/index.ts");
    expect(auth?.refs.some((r) => r.pkg === "better-auth")).toBe(true); // a dynamic import()
  });
});

describe("architecture boundaries", () => {
  it("client, server and shared stay apart", () => {
    const forbidden: Record<string, string[]> = { client: ["server"], server: ["client"], shared: ["client", "server"] };
    const violations: string[] = [];
    for (const f of scanned) {
      const from = regionOf(f.file);
      for (const r of f.refs) {
        if (!r.target) continue;
        const to = regionOf(r.target);
        if (!forbidden[from]?.includes(to)) continue;
        violations.push(
          `${f.file}:${r.line} imports "${r.spec}" (${r.target})\n` +
            `  rule: ${from} code must not import ${to} code\n` +
            `  fix: move what both sides need into shared/ and import it from "@shared/…"`,
        );
      }
    }
    expectNone("client/server/shared separation", violations);
  });

  it("outside libraries are loaded only by their gateway", () => {
    const violations: string[] = [];
    for (const f of scanned) {
      for (const r of f.refs) {
        if (!r.pkg) continue;
        for (const rule of PACKAGE_RULES) {
          if (!rule.matches(r.pkg) || rule.allowedIn.some((s) => within(f.file, s))) continue;
          violations.push(
            `${f.file}:${r.line} imports "${r.spec}"\n  rule: ${rule.what}\n  fix: ${rule.fix}\n` +
              `  (a real new gateway? add its path to that rule's allowedIn in server/architecture.test.ts, with a reason)`,
          );
        }
      }
    }
    expectNone("gateway-only packages", violations);
  });

  it("only allowlisted files start processes, and kubectl runs as the user without a shell", () => {
    const violations: string[] = [];
    for (const f of scanned) {
      for (const r of f.refs) {
        if (r.pkg !== "child_process" || CHILD_PROCESS_ALLOWED[f.file]) continue;
        violations.push(
          `${f.file}:${r.line} imports "${r.spec}"\n` +
            "  rule: only the files in CHILD_PROCESS_ALLOWED may start processes\n" +
            "  fix: run kubectl with spawnCommand / runKubectlRaw from server/kubectl-run.ts; if this file truly needs its own process,\n" +
            "       add it to CHILD_PROCESS_ALLOWED in server/architecture.test.ts with the reason",
        );
      }
      if (TEST_FILE.test(f.file)) continue;
      for (const s of f.spawns) {
        if (s.shell) {
          violations.push(
            `${f.file}:${s.line} calls ${s.fn}() through a shell\n` +
              "  rule: never run commands through a shell (AGENTS.md)\n" +
              "  fix: use spawn/execFile with an argument array and no `shell` option",
          );
        } else if (!s.viaAsUser) {
          violations.push(
            `${f.file}:${s.line} calls ${s.fn}() without asUser()\n` +
              "  rule: every kubectl spawn goes through asUser() so per-user impersonation applies (AGENTS.md)\n" +
              '  fix: pass the arguments as asUser(cmd, args) (import { asUser } from "./identity")',
          );
        }
      }
    }
    for (const [file, reason] of Object.entries(CHILD_PROCESS_ALLOWED)) {
      const f = scanned.find((s) => s.file === file);
      if (!f?.refs.some((r) => r.pkg === "child_process")) {
        violations.push(`${file} is in CHILD_PROCESS_ALLOWED ("${reason}") but no longer imports child_process\n  fix: remove the entry`);
      }
    }
    expectNone("process spawning", violations);
  });

  it("modules with a front door are imported only through their index", () => {
    const violations: string[] = [];
    const used = new Set<(typeof FRONT_DOOR_EXCEPTIONS)[number]>();
    for (const f of scanned) {
      for (const r of f.refs) {
        if (!r.target) continue;
        const door = FRONT_DOORS.find((d) => r.target!.startsWith(`${d}/`));
        if (!door || f.file.startsWith(`${door}/`)) continue;
        if (/^index\.(ts|tsx|js)$/.test(r.target.slice(door.length + 1))) continue;
        const exception = FRONT_DOOR_EXCEPTIONS.find((e) => e.from === f.file && e.to === r.target);
        if (exception) {
          used.add(exception);
          continue;
        }
        const spec = path.posix.relative(path.posix.dirname(f.file), door);
        violations.push(
          `${f.file}:${r.line} imports "${r.spec}" (${r.target})\n` +
            `  rule: ${door} has one front door; code outside it imports only ${door}/index.ts\n` +
            `  fix: export what you need from ${door}/index.ts and import from "${spec.startsWith(".") ? spec : `./${spec}`}" instead`,
        );
      }
    }
    for (const e of FRONT_DOOR_EXCEPTIONS) {
      if (!used.has(e)) violations.push(`FRONT_DOOR_EXCEPTIONS entry ${e.from} -> ${e.to} is no longer needed\n  fix: remove the entry`);
    }
    expectNone("module front doors", violations);
  });

  it("each table is read and written only by the module that owns it", () => {
    const violations: string[] = [];
    for (const f of scanned) {
      if (!f.file.startsWith("server/")) continue;
      for (const t of f.tables) {
        const where = `${f.file}:${t.line} calls ${t.method}("${t.table}")`;
        if (!(t.table in TABLE_OWNERS)) {
          violations.push(
            `${where}\n  rule: every table has one owning module\n` +
              "  fix: add the table to TABLE_OWNERS in server/architecture.test.ts with the folder that owns it",
          );
          continue;
        }
        const owner = TABLE_OWNERS[t.table];
        if (owner === null) {
          violations.push(
            `${where}\n  rule: "${t.table}" is a Better Auth table; only Better Auth touches it\n` +
              "  fix: use the Better Auth API through what server/auth exports",
          );
        } else if (!within(f.file, owner)) {
          violations.push(
            `${where}\n  rule: "${t.table}" belongs to ${owner}; only that module reads or writes it\n` +
              `  fix: call a function exported from ${owner.replace(/\/$/, "")}/index.ts instead of querying the table`,
          );
        }
      }
    }
    expectNone("table ownership", violations);
  });
});
