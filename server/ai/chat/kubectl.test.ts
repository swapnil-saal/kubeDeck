import { describe, expect, it } from "vitest";
import {
  checkRepeat,
  describeAccessLimits,
  execCommand,
  forbiddenHint,
  injectContextFlag,
  injectContextIntoBash,
  injectNamespaceFlag,
  narrowToNamespace,
  narrowBashToNamespace,
  injectNamespaceIntoBash,
  parseForbidden,
  parseTable,
  summarizeTable,
  recordCall,
  resetAgentCallGuards,
  quoteArg,
  truncate,
} from "./kubectl";
import { splitArgs } from "../../kubectl-safety";

const forbidden = (resource: string, ns?: string) =>
  `Error from server (Forbidden): ${resource} is forbidden: User "u1" cannot list resource "${resource}" in API group "" ` +
  (ns ? `in the namespace "${ns}"` : "at the cluster scope");

describe("command rewriting", () => {
  it("injects context once", () => {
    expect(injectContextFlag("get pods", "dev")).toBe("get --context=dev pods");
    expect(injectContextFlag("get pods --context=x", "dev")).toBe("get pods --context=x");
    expect(injectContextFlag("get pods", "")).toBe("get pods");
  });
  it("injects namespace only for namespaced verbs without an explicit scope", () => {
    expect(injectNamespaceFlag("get pods", "e2")).toBe("get pods -n e2");
    expect(injectNamespaceFlag("get pods -n other", "e2")).toBe("get pods -n other");
    expect(injectNamespaceFlag("get pods -A", "e2")).toBe("get pods -A");
    expect(narrowToNamespace("get pods -A -l app=kafka", "e2")).toEqual({ command: "get pods -l app=kafka -n e2", narrowed: true });
    expect(narrowToNamespace("get pods --all-namespaces", "e2").command).toBe("get pods -n e2");
    expect(narrowToNamespace("get pods -A", "all").narrowed).toBe(false);
    expect(narrowBashToNamespace("kubectl get pods -A | grep kafka", "e2")).toBe("kubectl get pods -n e2 | grep kafka");
    expect(narrowToNamespace("get pods -A", "").narrowed).toBe(false);
    expect(narrowToNamespace("get pods -n x -A", "e2").command).toBe("get pods -n x");
    expect(injectNamespaceFlag("get nodes", "all")).toBe("get nodes");
    expect(injectNamespaceFlag("cluster-info", "e2")).toBe("cluster-info");
  });
  it("rewrites every kubectl segment inside bash", () => {
    expect(injectContextIntoBash("kubectl get pods | wc -l", "dev")).toContain("--context=dev");
    expect(injectNamespaceIntoBash("kubectl get pods | grep x", "e2")).toBe("kubectl get pods -n e2 | grep x");
    expect(injectNamespaceIntoBash("kubectl get pods -n other | wc -l", "e2")).toBe("kubectl get pods -n other | wc -l");
  });
});

describe("truncate", () => {
  it("passes short output through", () => expect(truncate("hello")).toBe("hello"));
  it("keeps both the start and the end of long output", () => {
    const big = Array.from({ length: 600 }, (_, i) => `line-${i} ${"x".repeat(20)}`).join("\n");
    for (const bias of ["head", "even", "tail"] as const) {
      const out = truncate(big, bias);
      expect(out.length).toBeLessThan(6500);
      expect(out).toContain("line-0 ");
      expect(out).toContain("line-599");
      expect(out).toMatch(/lines omitted/);
    }
  });
  it("states the exact line total, so counts are not guessed from the visible part", () => {
    const big = Array.from({ length: 600 }, (_, i) => `pod-${i} 1/1 Running 0 3d`).join("\n") + "\n";
    const out = truncate(big);
    expect(out).toMatch(/EXACTLY 600 lines/);
    const [, shown, omitted] = out.match(/(\d+) are shown, (\d+) omitted/)!.map(Number);
    expect(shown + omitted).toBe(600);
    expect(shown).toBe((out.match(/^pod-\d+ /gm) ?? []).length);
  });
  it("gives the tail more room with the tail bias", () => {
    const big = Array.from({ length: 800 }, (_, i) => `row-${i}`).join("\n");
    const count = (s: string) => (s.match(/row-/g) ?? []).length;
    expect(count(truncate(big, "tail"))).toBeGreaterThan(0);
    const tail = truncate(big, "tail");
    const head = truncate(big, "head");
    expect(tail.indexOf("row-799")).toBeGreaterThan(-1);
    expect(head.indexOf("row-0\n")).toBeGreaterThan(-1);
  });
});

describe("Forbidden handling", () => {
  it("parses namespaced and cluster-scope errors", () => {
    expect(parseForbidden(forbidden("pods", "kube-system"))).toEqual({
      user: "u1", verb: "list", resource: "pods", scope: "kube-system",
    });
    expect(parseForbidden(forbidden("nodes"))).toMatchObject({ resource: "nodes", scope: "*" });
    expect(parseForbidden("Error: pod not found")).toBeNull();
  });
  it("normalises subresources and API groups", () => {
    const e = 'Error from server (Forbidden): pods/log is forbidden: User "u" cannot get resource "pods/log" in API group "" in the namespace "x"';
    expect(parseForbidden(e)?.resource).toBe("pods");
    const d = 'deployments.apps is forbidden: User "u" cannot list resource "deployments.apps" in API group "apps" in the namespace "x"';
    expect(parseForbidden(d)?.resource).toBe("deployments");
  });
  it("blocks a repeat in the same namespace but not a different one", () => {
    const t = "rbac-1";
    recordCall(t, "kubectl", "get pods -n a", forbidden("pods", "a"));
    expect(checkRepeat(t, "kubectl", "get pods -n a --no-headers")).toMatch(/ACCESS_DENIED/);
    expect(checkRepeat(t, "kubectl", "get pods -n b")).toBeNull();
  });
  it("treats two denied namespaces as no access anywhere", () => {
    const t = "rbac-2";
    recordCall(t, "kubectl", "get pods -n a", forbidden("pods", "a"));
    recordCall(t, "kubectl", "get pods -n b", forbidden("pods", "b"));
    expect(checkRepeat(t, "kubectl", "get pods -n c")).toMatch(/ACCESS_DENIED/);
    expect(checkRepeat(t, "kubectl", "get deployments -n c")).toBeNull();
  });
  it("does not let a cluster-wide denial block a single namespace", () => {
    const t = "rbac-3";
    recordCall(t, "kubectl", "get pods -A", forbidden("pods"));
    expect(checkRepeat(t, "kubectl", "get pods -A -o wide")).toMatch(/ACCESS_DENIED/);
    expect(checkRepeat(t, "kubectl", "get pods -n a")).toBeNull();
  });
  it("remembers limits across turns and describes them for the prompt", () => {
    const t = "rbac-4";
    recordCall(t, "kubectl", "get pods -n a", forbidden("pods", "a"));
    resetAgentCallGuards(t); // a new user turn
    expect(checkRepeat(t, "kubectl", "get pods -n a")).toMatch(/ACCESS_DENIED/);
    expect(describeAccessLimits(t)[0]).toMatch(/cannot list pods .*namespace a.* as u1/);
  });
  it("adds a hint to a Forbidden result only", () => {
    expect(forbiddenHint(forbidden("pods", "a"))).toMatch(/ACCESS_DENIED/);
    expect(forbiddenHint("NAME READY")).toBeNull();
  });
});

describe("repeat guard", () => {
  it("refuses an identical command and resets on a new turn", () => {
    const t = "rep-1";
    expect(checkRepeat(t, "kubectl", "get pods -n x")).toBeNull();
    recordCall(t, "kubectl", "get pods -n x", "NAME READY");
    expect(checkRepeat(t, "kubectl", "get pods -n x")).toMatch(/STOP_REPEATING/);
    resetAgentCallGuards(t);
    expect(checkRepeat(t, "kubectl", "get pods -n x")).toBeNull();
  });
  it("treats equivalent get-pods queries as the same intent", () => {
    const t = "rep-2";
    recordCall(t, "kubectl", "get pods -n x -o wide", "NAME READY");
    expect(checkRepeat(t, "bash", "kubectl get pods -n x --no-headers | wc -l")).toMatch(/STOP_REPEATING/);
  });
  it("caps discovery calls per turn", () => {
    const t = "rep-3";
    ["pods", "deployments", "services", "nodes", "events"].forEach((r) => recordCall(t, "kubectl", `get ${r} -n x`, "ok"));
    expect(checkRepeat(t, "kubectl", "get configmaps -n x")).toMatch(/STOP_REPEATING/);
  });
});

describe("execCommand", () => {
  it("returns stdout and the exit code", async () => {
    const r = await execCommand("sh", ["-c", "echo hi; exit 3"]);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.code).toBe(3);
  });
  it("kills the whole pipeline when aborted", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = execCommand("sh", ["-c", "sleep 20 | cat"], undefined, ac.signal);
    setTimeout(() => ac.abort(), 150);
    const r = await p;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.stderr).toBe("(cancelled)");
  });
  it("does not start when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await execCommand("sh", ["-c", "echo nope"], undefined, ac.signal);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("(cancelled)");
  });
});

describe("splitArgs / quoteArg", () => {
  it("splits on whitespace", () => expect(splitArgs("  get   pods -n x ")).toEqual(["get", "pods", "-n", "x"]));
  it("keeps quoted text as one argument", () => {
    expect(splitArgs("get services -l 'app in (e2-course)' -n e2")).toEqual(["get", "services", "-l", "app in (e2-course)", "-n", "e2"]);
    expect(splitArgs('get pods -l "a=b,c in (d, e)"')).toEqual(["get", "pods", "-l", "a=b,c in (d, e)"]);
  });
  it("does no shell expansion", () => {
    expect(splitArgs("get pods -l '$(id)'")).toEqual(["get", "pods", "-l", "$(id)"]);
  });
  it("keeps an empty quoted argument", () => expect(splitArgs("get pods -l ''")).toEqual(["get", "pods", "-l", ""]));
  it("quotes only when needed and never lets a quote through", () => {
    expect(quoteArg("app=api")).toBe("app=api");
    expect(quoteArg("app in (a,b)")).toBe("'app in (a,b)'");
    expect(quoteArg("a'b c")).toBe("'ab c'");
  });
  it("round-trips a selector through quote then split", () => {
    const sel = "env in (prod, staging),tier notin (db),!canary";
    expect(splitArgs(`get pods -l ${quoteArg(sel)}`)).toEqual(["get", "pods", "-l", sel]);
  });
});

describe("parseTable / summarizeTable", () => {
  const pods = [
    "NAME                                    READY   STATUS             RESTARTS        AGE",
    "e2-api-7d9f-abcde                       1/1     Running            0               3d",
    "e2-dashboard-agent-5486dd8c6f-sbfjx     0/1     CrashLoopBackOff   245 (2m ago)    12d",
    "e2-dashboard-mcp-744df7c888-r42k7       0/1     CrashLoopBackOff   12 (5m ago)     12d",
    "e2-worker-55c-xyz                       2/2     Running            3 (1h ago)      1d",
  ].join("\n");

  it("reads cells by header position, keeping values with spaces", () => {
    const { columns, rows } = parseTable(pods);
    expect(columns).toEqual(["NAME", "READY", "STATUS", "RESTARTS", "AGE"]);
    expect(rows[1]).toMatchObject({ NAME: "e2-dashboard-agent-5486dd8c6f-sbfjx", READY: "0/1", RESTARTS: "245 (2m ago)" });
  });

  it("gives exact totals, status counts, not-ready and top restarts", () => {
    const out = summarizeTable(pods, "pods");
    expect(out).toContain("4 pods.");
    expect(out).toContain("By STATUS: Running 2 · CrashLoopBackOff 2");
    expect(out).toMatch(/Not ready \(READY below desired\): 2 → e2-dashboard-agent-5486dd8c6f-sbfjx \(0\/1\)/);
    expect(out).toMatch(/With restarts: 3; most: e2-dashboard-agent-5486dd8c6f-sbfjx \(245\), e2-dashboard-mcp-744df7c888-r42k7 \(12\)/);
  });

  it("counts per namespace with -A", () => {
    const all = ["NAMESPACE   NAME   READY   STATUS    RESTARTS   AGE", "a           p1     1/1     Running   0          1d", "b           p2     1/1     Running   0          1d", "b           p3     0/1     Pending   0          1d"].join("\n");
    const out = summarizeTable(all, "pods");
    expect(out).toContain("By namespace: b 2, a 1");
    expect(out).toContain("b/p3 (0/1)");
  });

  it("handles an empty result", () => expect(summarizeTable("", "pods")).toBe("0 pods found."));
});
