import { describe, expect, it } from "vitest";
import { describeCatalog, resultText, toInfo } from "./hub";
import { GRAFANA_RULE } from "./grafana";
import { isReadTool, nameWords } from "./read-only";

describe("which tools of any MCP server only read", () => {
  it("splits names the same way whatever their style", () => {
    expect(nameWords("list_pods")).toEqual(["list", "pods"]);
    expect(nameWords("list-pods")).toEqual(["list", "pods"]);
    expect(nameWords("listPods")).toEqual(["list", "pods"]);
    expect(nameWords("repos.getContent")).toEqual(["repos", "get", "content"]);
  });

  it.each(["get_issue", "listPullRequests", "search-code", "query_metrics", "describe_cluster", "read_file", "fetchLogs"])("reads with %s", (name) =>
    expect(isReadTool({ name })).toBe(true));

  it.each(["create_issue", "deletePod", "merge-pull-request", "run_query", "get_or_create_user", "list_and_delete", "exec_command", "send_message", "do_things"])(
    "never offers %s as a read",
    (name) => expect(isReadTool({ name })).toBe(false),
  );

  it("believes a server that marks a tool destructive or not read-only, and lets it vouch for a read", () => {
    expect(isReadTool({ name: "get_x", annotations: { destructiveHint: true } })).toBe(false);
    expect(isReadTool({ name: "list_x", annotations: { readOnlyHint: false } })).toBe(false);
    expect(isReadTool({ name: "pods_top", annotations: { readOnlyHint: true } })).toBe(true);
    // a read-only hint does not outweigh a write word in the name
    expect(isReadTool({ name: "pods_delete", annotations: { readOnlyHint: true } })).toBe(false);
  });
});

describe("which Grafana MCP tools the assistant gets", () => {
  it.each([
    "search_tempo_traces", "get_tempo_trace", "query_loki_logs", "query_prometheus", "list_datasources", "search_dashboards",
    "get_dashboard_summary", "list_alert_groups", "alerting_rules_read", "generate_deeplink", "diff_tempo_traces", "list_incidents",
  ])("reads with %s", (name) => expect(isReadTool({ name }, GRAFANA_RULE)).toBe(true));

  it.each([
    "update_dashboard", "create_folder", "create_incident", "add_activity_to_incident", "alerting_rules_write", "alerting_manage_routing",
    "delete_annotation", "install_plugin", "grafana_api_request", "query_sql", "query_influxdb", "get_panel_image", "run_panel_query",
    "update_alert_group", "ask_assistant", "render_grafana_app",
  ])("never offers %s", (name) => expect(isReadTool({ name }, GRAFANA_RULE)).toBe(false));

  it("trusts the server when it marks a tool destructive or not read-only", () => {
    expect(isReadTool({ name: "get_x", annotations: { destructiveHint: true } }, GRAFANA_RULE)).toBe(false);
    expect(isReadTool({ name: "list_x", annotations: { readOnlyHint: false } }, GRAFANA_RULE)).toBe(false);
  });
});

describe("what the model reads", () => {
  it("describes a tool by its first sentence and its parameters", () => {
    const info = toInfo({
      name: "query_loki_logs",
      description: "Query and retrieve logs using LogQL.  Returns at most 100 lines.",
      inputSchema: { properties: { datasourceUid: { type: "string" }, logql: { type: "string" }, limit: { type: ["integer", "null"] } }, required: ["datasourceUid", "logql"] },
    });
    expect(info).toEqual({ name: "query_loki_logs", description: "Query and retrieve logs using LogQL.", params: ["datasourceUid*: string", "logql*: string", "limit: integer|null"] });
    expect(describeCatalog([info])).toBe("- query_loki_logs(datasourceUid*: string, logql*: string, limit: integer|null): Query and retrieve logs using LogQL.");
  });

  it("turns a result into text, marks errors with the server's name and cuts long output", () => {
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }] })).toBe("a\n[image content left out]");
    expect(resultText({ content: [{ type: "text", text: "no datasource" }], isError: true }, "Grafana")).toBe("Error from Grafana: no datasource");
    expect(resultText({ content: [], isError: true })).toBe("Error from the MCP server: the tool failed");
    expect(resultText({ content: [], structuredContent: { n: 1 } })).toBe('{"n":1}');
    expect(resultText({ content: [{ type: "text", text: "x".repeat(20_000) }] })).toMatch(/cut at 14000 characters/);
  });
});
