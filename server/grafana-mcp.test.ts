import { describe, expect, it } from "vitest";
import { describeCatalog, isReadTool, resultText, toInfo } from "./grafana-mcp";

describe("which Grafana MCP tools the assistant gets", () => {
  it.each([
    "search_tempo_traces", "get_tempo_trace", "query_loki_logs", "query_prometheus", "list_datasources", "search_dashboards",
    "get_dashboard_summary", "list_alert_groups", "alerting_rules_read", "generate_deeplink", "diff_tempo_traces", "list_incidents",
  ])("reads with %s", (name) => expect(isReadTool({ name })).toBe(true));

  it.each([
    "update_dashboard", "create_folder", "create_incident", "add_activity_to_incident", "alerting_rules_write", "alerting_manage_routing",
    "delete_annotation", "install_plugin", "grafana_api_request", "query_sql", "query_influxdb", "get_panel_image", "run_panel_query",
    "update_alert_group", "ask_assistant", "render_grafana_app",
  ])("never offers %s", (name) => expect(isReadTool({ name })).toBe(false));

  it("trusts the server when it marks a tool destructive or not read-only", () => {
    expect(isReadTool({ name: "get_x", annotations: { destructiveHint: true } })).toBe(false);
    expect(isReadTool({ name: "list_x", annotations: { readOnlyHint: false } })).toBe(false);
  });

  it("describes a tool by its first sentence and its parameters", () => {
    const info = toInfo({
      name: "query_loki_logs",
      description: "Query and retrieve logs using LogQL.  Returns at most 100 lines.",
      inputSchema: { properties: { datasourceUid: { type: "string" }, logql: { type: "string" }, limit: { type: ["integer", "null"] } }, required: ["datasourceUid", "logql"] },
    });
    expect(info).toEqual({ name: "query_loki_logs", description: "Query and retrieve logs using LogQL.", params: ["datasourceUid*: string", "logql*: string", "limit: integer|null"] });
    expect(describeCatalog([info])).toBe("- query_loki_logs(datasourceUid*: string, logql*: string, limit: integer|null): Query and retrieve logs using LogQL.");
  });

  it("turns a result into text, marks errors and cuts long output", () => {
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }] })).toBe("a\n[image content left out]");
    expect(resultText({ content: [{ type: "text", text: "no datasource" }], isError: true })).toBe("Error from Grafana: no datasource");
    expect(resultText({ content: [], structuredContent: { n: 1 } })).toBe('{"n":1}');
    expect(resultText({ content: [{ type: "text", text: "x".repeat(20_000) }] })).toMatch(/cut at 14000 characters/);
  });
});
