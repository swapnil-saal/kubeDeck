import { describe, expect, it } from "vitest";
import {
  applyFilter, compileExclude, countLevels, detectNoise, formatTime, highlightRanges, highlightRegex,
  parseEntry, parseQuery, podLabels, shortPod, signature, sortByTime, splitTimestamp, tokenize, topProblems,
  type LogEntry, type ViewFilter,
} from "./logs";

// Real lines from e2-admin-module (pino JSON), as `kubectl logs --timestamps` prints them.
const HC_IN = '2026-10-05T12:24:19.547123456Z {"level":"info","time":"2026-10-05T12:24:19.547Z","name":"e2-admin-module","version":"2.0.0","message":"Request received","method":"GET","path":"/healthcheck","requestId":"O4xyC-7H4DXjIYuPCoc_P","v":1}';
const HC_OUT = '2026-10-05T12:24:19.548123456Z {"level":"info","time":"2026-10-05T12:24:19.548Z","name":"e2-admin-module","version":"2.0.0","message":"Request served","method":"GET","path":"/healthcheck","requestId":"O4xyC-7H4DXjIYuPCoc_P","statusCode":200,"v":1}';
const API_ERR = '2026-10-05T12:25:01.100Z {"level":"error","time":"2026-10-05T12:25:01.100Z","message":"Database timeout after 5000ms","method":"POST","path":"/api/users","requestId":"abc123abc123abc123"}';
const API_OK = '2026-10-05T12:25:02.000Z {"level":"info","message":"Request served","method":"GET","path":"/api/users","statusCode":200}';

const opts = { regex: false, caseSensitive: false };
const entries = (lines: string[], source?: string) => lines.map((l, i) => parseEntry(l, i, source));
const view = (over: Partial<ViewFilter> = {}): ViewFilter => ({
  query: parseQuery("", opts), exclude: [], levels: null, sources: null, context: 0, ...over,
});

describe("parseEntry", () => {
  it("splits the kubectl timestamp and parses pino JSON", () => {
    const e = parseEntry(HC_IN, 1);
    expect(e.format).toBe("json");
    expect(e.level).toBe("info");
    expect(e.message).toBe("Request received");
    expect(e.ts).toBe(Date.parse("2026-10-05T12:24:19.547123456Z"));
    expect(e.fields).toMatchObject({ method: "GET", path: "/healthcheck" });
    expect(e.fields).not.toHaveProperty("message");
    expect(e.fields).not.toHaveProperty("level");
    expect(e.raw.startsWith("{")).toBe(true); // timestamp removed from raw
  });
  it("maps numeric pino/bunyan levels", () => {
    expect(parseEntry('{"level":30,"msg":"x"}', 1).level).toBe("info");
    expect(parseEntry('{"level":40,"msg":"x"}', 1).level).toBe("warn");
    expect(parseEntry('{"level":50,"msg":"x"}', 1).level).toBe("error");
    expect(parseEntry('{"level":60,"msg":"x"}', 1).level).toBe("fatal");
    expect(parseEntry('{"severity":"WARNING","message":"x"}', 1).level).toBe("warn");
  });
  it("uses the JSON's own time when kubectl gave none", () => {
    expect(parseEntry('{"time":"2026-10-05T01:02:03.000Z","msg":"x"}', 1).ts).toBe(Date.parse("2026-10-05T01:02:03.000Z"));
    expect(parseEntry('{"ts":1790000000,"msg":"x"}', 1).ts).toBe(1790000000 * 1000);
  });
  it("parses logfmt", () => {
    const e = parseEntry('level=error msg="connection refused" host=db-1 retries=3', 1);
    expect(e.format).toBe("logfmt");
    expect(e.level).toBe("error");
    expect(e.message).toBe("connection refused");
    expect(e.fields).toMatchObject({ host: "db-1", retries: "3" });
  });
  it("parses klog / Go style lines", () => {
    const e = parseEntry("E1005 12:24:19.123456       1 controller.go:210] failed to sync", 1);
    expect(e.format).toBe("klog");
    expect(e.level).toBe("error");
    expect(e.message).toBe("failed to sync");
  });
  it("detects levels in plain text conservatively", () => {
    expect(parseEntry("2026-01-01 ERROR something broke", 1).level).toBe("error");
    expect(parseEntry("WARN disk 91% full", 1).level).toBe("warn");
    expect(parseEntry("Traceback (most recent call last):", 1).level).toBe("error");
    expect(parseEntry("panic: runtime error: nil pointer", 1).level).toBe("fatal");
    expect(parseEntry("processed 0 failed, error handling enabled", 1).level).toBe("unknown");
  });
  it("treats broken JSON as text", () => {
    const e = parseEntry('{"level":"info","msg":', 1);
    expect(e.format).toBe("text");
  });
  it("keeps the pod and container", () => {
    const e = parseEntry("hello", 1, "pod-a", "app");
    expect(e).toMatchObject({ source: "pod-a", container: "app" });
  });
});

describe("splitTimestamp", () => {
  it("handles offsets and missing timestamps", () => {
    expect(splitTimestamp("2026-10-05T12:00:00+02:00 hi").rest).toBe("hi");
    expect(splitTimestamp("no timestamp here").ts).toBeUndefined();
  });
});

describe("query language", () => {
  const all = entries([HC_IN, HC_OUT, API_ERR, API_OK]);
  const run = (q: string, o = opts, extra: Partial<ViewFilter> = {}) => applyFilter(all, view({ query: parseQuery(q, o), ...extra }));

  it("tokenizes terms, phrases and regex literals", () => {
    expect(tokenize('timeout -healthcheck "request served" /err(or)?/i level:warn,error')).toEqual([
      "timeout", "-healthcheck", '"request served"', "/err(or)?/i", "level:warn,error",
    ]);
  });
  it("ANDs terms", () => {
    expect(run("users timeout").matches).toBe(1);
    expect(run("users").matches).toBe(2);
  });
  it("excludes with -term (the health-check case)", () => {
    expect(run("request").matches).toBe(4); // the error line has a requestId too
    expect(run("request -healthcheck").matches).toBe(2);
    expect(run("-healthcheck").matches).toBe(2);
  });
  it("matches quoted phrases", () => {
    expect(run('"request served"').matches).toBe(2);
  });
  it("filters by level, including level: in the query", () => {
    expect(run("level:error").matches).toBe(1);
    expect(run("level:warn,error").matches).toBe(1);
    expect(applyFilter(all, view({ levels: new Set(["info"]) })).matches).toBe(3);
  });
  it("treats an error filter as including fatal", () => {
    const f = entries(['{"level":"fatal","msg":"boom"}', '{"level":"error","msg":"bad"}', '{"level":"info","msg":"ok"}']);
    expect(applyFilter(f, view({ query: parseQuery("level:error", opts) })).matches).toBe(2);
  });
  it("supports /regex/ literals and regex mode", () => {
    expect(run("/time(out|d)/").matches).toBe(1);
    expect(run("served|received", { regex: true, caseSensitive: false }).matches).toBe(3);
  });
  it("is case-insensitive unless asked", () => {
    expect(run("DATABASE").matches).toBe(1);
    expect(run("DATABASE", { regex: false, caseSensitive: true }).matches).toBe(0);
  });
  it("reports an invalid regex and matches nothing instead of everything", () => {
    const q = parseQuery("/(unclosed/", opts);
    expect(q.error).toBeTruthy();
    expect(applyFilter(all, view({ query: q })).matches).toBe(0);
  });
  it("treats a bare number with a dash as a term, not an exclusion", () => {
    expect(parseQuery("-5", opts).mustNot).toHaveLength(0);
  });
  it("filters by pod", () => {
    const two = [...entries(["a one"], "web-aaa"), ...entries(["b two"], "web-bbb").map((e) => ({ ...e, id: e.id + 10 }))];
    expect(applyFilter(two, view({ query: parseQuery("pod:bbb", opts) })).rows).toHaveLength(1);
    expect(applyFilter(two, view({ sources: new Set(["web-aaa"]) })).rows).toHaveLength(1);
  });
  it("shows context lines around matches with a gap marker", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    const r = applyFilter(entries(lines), view({ query: parseQuery("line 2 | x", opts), context: 1 }));
    // no "|" operator: the query is the terms "line", "2", "|", "x" — nothing matches both; use a clean query
    const r2 = applyFilter(entries(lines), view({ query: parseQuery("/line (2|7)$/", opts), context: 1 }));
    expect(r.matches).toBe(0);
    const kinds = r2.rows.map((x) => (x.kind === "gap" ? "…" : (x as any).entry.raw));
    expect(kinds).toEqual(["line 1", "line 2", "line 3", "…", "line 6", "line 7", "line 8"]);
    expect(r2.rows.filter((x) => x.kind === "entry" && x.match)).toHaveLength(2);
  });
});

describe("always-hide patterns", () => {
  const all = entries([HC_IN, HC_OUT, API_ERR]);
  it("hides matching lines and counts them", () => {
    const ex = [compileExclude("/healthcheck")!];
    const r = applyFilter(all, view({ exclude: ex }));
    expect(r.rows).toHaveLength(1);
    expect(r.hiddenByExclude).toBe(2);
  });
  it("accepts /regex/ and ignores blanks", () => {
    expect(compileExclude("   ")).toBeNull();
    const m = compileExclude("/Request (received|served)/i")!;
    expect(m(all[0])).toBe(true);
    expect(m(all[2])).toBe(false);
  });
  it("level counts follow what is not hidden", () => {
    const r = applyFilter(all, view({ exclude: [compileExclude("/healthcheck")!] }));
    expect(countLevels(r.base)).toMatchObject({ info: 0, error: 1 });
  });
});

describe("detectNoise", () => {
  const noisy = () => {
    const out: string[] = [];
    for (let i = 0; i < 95; i++) {
      out.push(HC_IN.replace("O4xyC-7H4DXjIYuPCoc_P", `req${i}ABCDEFGHIJKLMNOP`));
      out.push(HC_OUT.replace("O4xyC-7H4DXjIYuPCoc_P", `req${i}ABCDEFGHIJKLMNOP`));
    }
    out.push(API_ERR, API_OK);
    return entries(out);
  };

  it("collapses 'received' and 'served' for the same path into one health-check suggestion", () => {
    const n = detectNoise(noisy());
    expect(n[0].pattern).toBe("/healthcheck");
    expect(n[0].count).toBe(190);
    expect(n[0].probe).toBe(true);
    expect(n[0].pct).toBeGreaterThan(0.9);
  });
  it("suggests nothing for a normal log", () => {
    expect(detectNoise(entries([API_ERR, API_OK, "a", "b"]))).toEqual([]);
  });
  it("flags a line that repeats with only numbers changing, as a regex that matches only those lines", () => {
    const rep = Array.from({ length: 40 }, (_, i) => `2026-10-05T12:00:${String(i).padStart(2, "0")}Z cache refreshed in ${i}ms`);
    const all = entries([...rep, "something else", "and another"]);
    const n = detectNoise(all);
    expect(n[0].probe).toBe(false);
    expect(n[0].count).toBe(40);
    expect(n[0].pattern.startsWith("/cache refreshed in")).toBe(true);
    const m = compileExclude(n[0].pattern)!;
    expect(all.filter((e) => m(e))).toHaveLength(40);
    expect(m(all[all.length - 1])).toBe(false);
  });
  it("uses plain text when the repeating message has no numbers", () => {
    const rep = Array.from({ length: 20 }, () => "2026-10-05T12:00:00Z Cache warmed for tenant acme");
    expect(detectNoise(entries([...rep, "x", "y", "z"]))[0].pattern).toBe("Cache warmed for tenant acme");
  });
  it("does NOT suggest hiding a message that is shared by many different requests", () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) lines.push(`{"level":"info","message":"Request served","method":"GET","path":"/letters?courseId=c${i}","statusCode":200}`);
    for (let i = 0; i < 30; i++) lines.push(`{"level":"info","message":"Request served","method":"GET","path":"/users/${i}","statusCode":200}`);
    for (let i = 0; i < 30; i++) lines.push(`{"level":"info","message":"Request served","method":"POST","path":"/orders","body":"x${i}","statusCode":201}`);
    const sugg = detectNoise(entries(lines));
    // each endpoint repeats, but the only pattern that describes it ("Request served") also hides the others
    expect(sugg.every((x) => x.pattern !== "Request served")).toBe(true);
  });
  it("treats heartbeats as probes", () => {
    const rep = Array.from({ length: 20 }, () => "Heartbeat sent to controller");
    const n = detectNoise(entries([...rep, "x", "y", "z"]));
    expect(n[0].probe).toBe(true);
  });
  it("recognises other probe styles", () => {
    const lines = Array.from({ length: 20 }, () => 'GET /healthz HTTP/1.1" 200 kube-probe/1.32');
    expect(detectNoise(entries(lines))[0].probe).toBe(true);
  });
  it("hiding the suggestion removes exactly the noise", () => {
    const all = noisy();
    const sug = detectNoise(all)[0];
    const r = applyFilter(all, view({ exclude: [compileExclude(sug.pattern)!] }));
    expect(r.rows).toHaveLength(2);
    expect(r.hiddenByExclude).toBe(190);
  });
});

describe("topProblems / signature", () => {
  it("groups errors that differ only by ids and numbers", () => {
    const e = entries([
      '{"level":"error","message":"Timeout after 5000ms for order 1234"}',
      '{"level":"error","message":"Timeout after 3000ms for order 99"}',
      '{"level":"warn","message":"Slow query"}',
      '{"level":"info","message":"fine"}',
    ]);
    const top = topProblems(e);
    expect(top[0]).toMatchObject({ count: 2, level: "error" });
    expect(top).toHaveLength(2);
  });
  it("normalises timestamps, uuids and long ids", () => {
    expect(signature("2026-10-05T12:00:00Z user 550e8400-e29b-41d4-a716-446655440000 took 12ms"))
      .toBe("<t> user <id> took <n>ms");
  });
});

describe("helpers", () => {
  it("shortens pod names", () => {
    expect(shortPod("e2-admin-module-dd8c44c74-pgz4r", "e2-admin-module")).toBe("dd8c44c74-pgz4r");
    expect(shortPod("web-5d79ccfd54-abcde")).toBe("5d79ccfd54-abcde");
    expect(shortPod("nifi-0", "nifi")).toBe("0");
  });
  it("labels replicas by what tells them apart", () => {
    const names = ["e2-course-5584d999b5-9wvpw", "e2-course-5584d999b5-g8jxg"];
    const l = podLabels(names, "e2-course");
    expect(l.get(names[0])).toBe("9wvpw");
    expect(l.get(names[1])).toBe("g8jxg");
    // pods from two ReplicaSets (mid-rollout) keep the hash too
    const roll = ["web-aaa111-xxxxx", "web-bbb222-yyyyy"];
    expect(podLabels(roll, "web").get(roll[0])).toBe("aaa111-xxxxx");
    // statefulset ordinals
    expect(podLabels(["nifi-0", "nifi-1", "nifi-2"], "nifi").get("nifi-1")).toBe("1");
    expect(podLabels(["solo-abc12-q1w2e"], "solo").get("solo-abc12-q1w2e")).toBe("abc12-q1w2e");
  });
  it("sorts by time, keeping arrival order for ties and missing times", () => {
    const e = [
      { ...parseEntry("2026-10-05T12:00:02Z b", 0) },
      { ...parseEntry("no time", 1) },
      { ...parseEntry("2026-10-05T12:00:01Z a", 2) },
    ] as LogEntry[];
    expect(sortByTime(e).map((x) => x.raw)).toEqual(["a", "b", "no time"]);
  });
  it("formats times", () => {
    expect(formatTime(undefined)).toBe("");
    expect(formatTime(Date.parse("2026-10-05T12:24:19.547Z"))).toMatch(/^\d{2}:\d{2}:\d{2}\.547$/);
  });
  it("highlights every positive term and skips exclusions and fields", () => {
    const re = highlightRegex("timeout -healthcheck level:error db", opts)!;
    const parts = highlightRanges("db timeout on healthcheck", re);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["db", "timeout"]);
    expect(highlightRegex("-only level:warn", opts)).toBeNull();
  });
});
