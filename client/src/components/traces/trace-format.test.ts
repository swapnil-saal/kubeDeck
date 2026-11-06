import { describe, expect, it } from "vitest";
import type { TraceSpan } from "@shared/traces";
import { fmtMs, fmtPercent, fmtRate, grafanaLink, spanSummary, spanTree, visibleRows } from "./trace-format";

const span = (id: string, parentId: string, offsetMs: number, extra: Partial<TraceSpan> = {}): TraceSpan => ({
  id, parentId, name: id, service: "api", namespace: "e2", workload: "api", pod: "api-1", kind: "server",
  offsetMs, durationMs: 1, error: false, statusMessage: "", attributes: {}, events: [], ...extra,
});

describe("trace formatting", () => {
  it.each([[0.25, "0.25ms"], [3.14, "3.1ms"], [35.4, "35ms"], [1234, "1.23s"], [12_345, "12.3s"], [125_000, "2m 5s"]])("%s ms reads %s", (ms, text) => expect(fmtMs(ms)).toBe(text));
  it.each([[26.5, "27/s"], [3.2, "3.2/s"], [0.5, "30/min"], [0.0022, "8/h"], [0, "0"]])("%s per second reads %s", (r, text) => expect(fmtRate(r)).toBe(text));
  it("shows a small error share precisely", () => {
    expect(fmtPercent(0.0011, 0.0022)).toBe("50%");
    expect(fmtPercent(1, 2500)).toBe("0.04%");
    expect(fmtPercent(0, 5)).toBe("0%");
  });
  it("fills the trace id into the Grafana link", () => {
    expect(grafanaLink("https://g/explore?panes=%22__TRACE_ID__%22", "abc")).toBe("https://g/explore?panes=%22abc%22");
    expect(grafanaLink(null, "abc")).toBeNull();
  });
  it("says what a span did", () => {
    expect(spanSummary(span("a", "", 0, { attributes: { "http.request.method": "POST", "url.path": "/login", "http.response.status_code": "500" } }))).toBe("POST /login → 500");
    expect(spanSummary(span("a", "", 0, { attributes: { "db.system.name": "mongodb", "db.operation.name": "find" } }))).toBe("mongodb find");
    expect(spanSummary(span("a", "", 0, { attributes: { "messaging.system": "kafka", "messaging.destination.name": "orders" } }))).toBe("kafka orders");
    expect(spanSummary(span("a", "", 0))).toBe("");
  });
});

describe("span tree", () => {
  const spans = [span("root", "", 0), span("b", "root", 20), span("a", "root", 10), span("a1", "a", 11), span("orphan", "missing", 5)];

  it("puts children under their parent in start order; a span without its parent starts a branch", () => {
    expect(spanTree(spans).map((r) => `${"-".repeat(r.depth)}${r.span.id}:${r.descendants}`)).toEqual(["root:3", "-a:1", "--a1:0", "-b:0", "orphan:0"]);
  });

  it("hides a collapsed span's descendants", () => {
    expect(visibleRows(spanTree(spans), new Set(["a"])).map((r) => r.span.id)).toEqual(["root", "a", "b", "orphan"]);
    expect(visibleRows(spanTree(spans), new Set(["root"])).map((r) => r.span.id)).toEqual(["root", "orphan"]);
  });

  it("survives a span that names itself as parent", () => {
    expect(spanTree([span("x", "x", 0)]).map((r) => r.span.id)).toEqual(["x"]);
  });
});
