import { describe, expect, it } from "vitest";
import {
  b64ToHex, extraCondition, metricsLimitSeconds, searchSlices, windowLabel, grafanaTraceUrl, parseTrace, q, scopeConditions, searchQuery, TempoError, toSummary, traceqlDuration,
} from "./tempo";
import { condenseTrace } from "./ai/chat/observability-tools";
import { mergeObservability, observabilityFromEnv, parseClusterMap } from "./settings";
import { cleanObservability } from "./settings-routes";

const o = observabilityFromEnv({});

describe("TraceQL building", () => {
  it("quotes string literals", () => {
    expect(q('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("puts a workload inside its cluster and namespace", () => {
    expect(scopeConditions({ cluster: "shared", namespace: "shop", workload: { kind: "deployment", name: "api" } })).toEqual([
      'resource.k8s.cluster.name="shared"', 'resource.k8s.namespace.name="shop"', 'resource.k8s.deployment.name="api"',
    ]);
  });

  it("leaves the namespace out for all namespaces", () => {
    expect(scopeConditions({ cluster: "c", namespace: "all", service: "web" })).toEqual(['resource.k8s.cluster.name="c"', 'resource.service.name="web"']);
  });

  it("searches requests by default, every span on request", () => {
    expect(searchQuery({ cluster: "c" }, { errors: true, minDuration: "2s" })).toBe(
      '{resource.k8s.cluster.name="c" && (kind=server || kind=consumer) && status=error && duration>=2s} | select(name, status, kind, span.http.route, span.http.response.status_code)',
    );
    expect(searchQuery({ cluster: "c" }, { entryOnly: false })).not.toContain("kind=server");
  });

  it.each(["500ms", "2s", "1.5s", "1m"])("accepts the duration %s", (d) => expect(traceqlDuration(d)).toBe(d));
  it.each(["2", "1h", "1s; drop", ""])("refuses the duration %j", (d) => expect(() => traceqlDuration(d)).toThrow(TempoError));

  it("lets an extra condition narrow the scope, never widen it", () => {
    expect(extraCondition('span.http.route = "/login" || span.http.route = "/logout"')).toBe('(span.http.route = "/login" || span.http.route = "/logout")');
    expect(extraCondition('span.msg = "a } { | b"')).toBe('(span.msg = "a } { | b")');
    for (const bad of ['true } || { true', "x | count() > 1", 'span.a = "open', "{ true }"]) {
      expect(() => extraCondition(bad), bad).toThrow(TempoError);
    }
  });
});

describe("Tempo's metrics window limit", () => {
  it("reads the cap from Tempo's refusal", () => {
    expect(metricsLimitSeconds("Tempo answered 400: metrics query time range exceeds the maximum allowed duration of 3h0m0s")).toBe(10_800);
    expect(metricsLimitSeconds("… maximum allowed duration of 90m0s")).toBe(5_400);
    expect(metricsLimitSeconds("… maximum allowed duration of 45s")).toBe(45);
    expect(metricsLimitSeconds("something else")).toBeNull();
  });
  it("labels a window", () => {
    expect(windowLabel(10_800)).toBe("3h");
    expect(windowLabel(5_400)).toBe("90m");
  });
});

describe("search slices", () => {
  it("looks at the last 5 minutes, then the last hour, then the whole window", () => {
    expect(searchSlices(0, 86_400)).toEqual([86_100, 82_800, 0]);
    expect(searchSlices(82_800, 86_400)).toEqual([86_100, 82_800]);
    expect(searchSlices(85_500, 86_400)).toEqual([86_100, 85_500]);
  });
});

describe("search results", () => {
  // the shape Tempo 3.1 returns for /api/search with select(…)
  const raw = {
    traceID: "13f115df8f963ba5e67079fa565f14c",
    rootServiceName: "reports",
    rootTraceName: "POST /course_statistics_insights",
    startTimeUnixNano: "1793953385425686233",
    durationMs: 35,
    spanSets: [{
      matched: 2,
      spans: [
        { spanID: "a", startTimeUnixNano: "1793953385425686233", durationNanos: "943624", attributes: [{ key: "status", value: { stringValue: "unset" } }] },
        {
          spanID: "b", startTimeUnixNano: "1793953385425686233", durationNanos: "35446088", attributes: [
            { key: "name", value: { stringValue: "POST /course_statistics_insights" } }, { key: "status", value: { stringValue: "error" } },
            { key: "kind", value: { stringValue: "server" } }, { key: "http.route", value: { stringValue: "/course_statistics_insights" } },
          ],
        },
      ],
    }],
    serviceStats: { "reports": { spanCount: 4, errorCount: 1 } },
  };

  it("stands for the trace with its longest matching span", () => {
    const s = toSummary(raw);
    expect(s).toMatchObject({ traceId: raw.traceID, rootService: "reports", start: 1793953385425, durationMs: 35, matched: 2 });
    expect(s.span).toMatchObject({ name: "POST /course_statistics_insights", error: true, kind: "server", route: "/course_statistics_insights" });
    expect(s.span!.durationMs).toBeCloseTo(35.446, 2);
    expect(s.services).toEqual([{ name: "reports", spans: 4, errors: 1 }]);
  });

  it("reads Tempo's \"nil\" as missing", () => {
    const s = toSummary({ ...raw, spanSets: [{ matched: 1, spans: [{ spanID: "x", startTimeUnixNano: "1", durationNanos: "5", attributes: [{ key: "http.route", value: { stringValue: "nil" } }] }] }] });
    expect(s.span?.route).toBe("");
  });
});

describe("one trace", () => {
  const id = (hex: string) => Buffer.from(hex, "hex").toString("base64");
  const res = (service: string, ns: string) => ({
    attributes: [
      { key: "service.name", value: { stringValue: service } }, { key: "k8s.namespace.name", value: { stringValue: ns } },
      { key: "k8s.deployment.name", value: { stringValue: service } }, { key: "k8s.pod.name", value: { stringValue: `${service}-1` } },
      { key: "host.name", value: { stringValue: "node-1" } },
    ],
  });
  const raw = {
    trace: {
      resourceSpans: [
        {
          resource: res("api", "shop"),
          scopeSpans: [{
            spans: [
              { spanId: id("0000000000000001"), name: "POST /login", kind: "SPAN_KIND_SERVER", startTimeUnixNano: "1000000000", endTimeUnixNano: "1250000000", status: { code: "STATUS_CODE_ERROR", message: "boom" },
                attributes: [{ key: "http.response.status_code", value: { intValue: "500" } }],
                events: [{ name: "exception", timeUnixNano: "1200000000", attributes: [{ key: "exception.type", value: { stringValue: "ValueError" } }, { key: "exception.message", value: { stringValue: "bad input" } }] }] },
              { spanId: id("0000000000000002"), parentSpanId: id("0000000000000001"), name: "find", kind: "SPAN_KIND_CLIENT", startTimeUnixNano: "1010000000", endTimeUnixNano: "1060000000", attributes: [{ key: "db.system.name", value: { stringValue: "mongodb" } }] },
            ],
          }],
        },
        {
          resource: res("auth", "shop"),
          scopeSpans: [{ spans: [{ spanId: id("0000000000000003"), parentSpanId: id("0000000000000001"), name: "GET /roles", kind: "SPAN_KIND_SERVER", startTimeUnixNano: "1100000000", endTimeUnixNano: "1200000000" }] }],
        },
      ],
    },
  };

  it("flattens spans with offsets, hex ids and their workload", () => {
    const t = parseTrace("abc", raw);
    expect(t).toMatchObject({ traceId: "abc", start: 1000, durationMs: 250, hidden: 0 });
    expect(t.spans.map((s) => [s.id, s.parentId, s.service, s.offsetMs, s.durationMs])).toEqual([
      ["0000000000000001", "", "api", 0, 250],
      ["0000000000000002", "0000000000000001", "api", 10, 50],
      ["0000000000000003", "0000000000000001", "auth", 100, 100],
    ]);
    const root = t.spans[0];
    expect(root).toMatchObject({ kind: "server", error: true, statusMessage: "boom", workload: "api", pod: "api-1", namespace: "shop" });
    expect(root.attributes["http.response.status_code"]).toBe("500");
    expect(root.attributes["resource.host.name"]).toBe("node-1");
    expect(root.attributes["resource.service.name"]).toBeUndefined();
    expect(root.events[0]).toMatchObject({ name: "exception", offsetMs: 200 });
  });

  it("condenses for the assistant: errors with the exception, the slowest spans, the tree", () => {
    const text = condenseTrace(parseTrace("abc", raw));
    expect(text).toContain("250ms · 3 spans");
    expect(text).toContain("api 2 (1 errors), auth 1");
    expect(text).toMatch(/Errors:\n- api \[shop\] server "POST \/login" 250ms status=500 — boom · ValueError · bad input/);
    expect(text).toContain('✗ +0.00ms 250ms api [shop] "POST /login"'.replace("0.00ms", "0.0ms"));
    expect(text).toContain('  · +100ms 100ms auth [shop] "GET /roles"');
  });

  it("reads Tempo's base64 ids as hex", () => {
    expect(b64ToHex("frope1L+78k=")).toBe("7eba297b52feefc9");
    expect(b64ToHex(undefined)).toBe("");
  });

  it("has no spans for an empty trace", () => {
    expect(parseTrace("x", {}).spans).toEqual([]);
  });
});

describe("observability settings", () => {
  it("reads a context → cluster map", () => {
    expect(parseClusterMap("prod-admin=shared, dev = dev,broken,=x,y=")).toEqual({ "prod-admin": "shared", dev: "dev" });
  });

  it("lets saved values win and falls back to the environment", () => {
    const env = observabilityFromEnv({ KUBEDECK_TEMPO_URL: "https://env", KUBEDECK_TEMPO_CLUSTERS: "a=x,b=y", KUBEDECK_GRAFANA_MCP_URL: "https://mcp" });
    const m = mergeObservability({ tempoUrl: "https://saved", clusters: { b: "z" } }, env);
    expect(m).toMatchObject({ tempoUrl: "https://saved", mcpUrl: "https://mcp", clusters: { a: "x", b: "z" } });
  });

  it("accepts only known fields and http(s) URLs from the settings form", () => {
    expect(cleanObservability({ tempoUrl: " https://tempo.example.com ", extra: "x", clusters: { a: "b", " ": "c" } })).toEqual({ tempoUrl: "https://tempo.example.com", clusters: { a: "b" } });
    expect(cleanObservability({ tempoUrl: "file:///etc/passwd" })).toBeNull();
    expect(cleanObservability({ clusters: ["a"] })).toBeNull();
    expect(cleanObservability("x")).toBeNull();
  });

  it("links a trace to Grafana Explore only with a Grafana URL and data source", () => {
    expect(grafanaTraceUrl(o)).toBeNull();
    const url = grafanaTraceUrl({ ...o, grafanaUrl: "https://grafana.example.com/", grafanaTempoDatasource: "tempo-uid" })!;
    expect(url.startsWith("https://grafana.example.com/explore?schemaVersion=1&panes=")).toBe(true);
    const panes = JSON.parse(decodeURIComponent(url.split("panes=")[1]));
    expect(panes.a.queries[0]).toMatchObject({ query: "__TRACE_ID__", datasource: { type: "tempo", uid: "tempo-uid" } });
  });
});
