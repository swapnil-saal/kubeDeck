/**
 * MCP: the hub that talks to MCP servers (the only code using @ai-sdk/mcp), the read-only rule, and
 * the plugins built on it: Grafana (built in, the `grafana` tool) and MCP servers an admin adds
 * (`mcp_<name>` tools). Importing this module defines those plugins; they register their tools when
 * the plugin manager starts them.
 */
import "./grafana";
import "./servers";

export { connectMcp, describeCatalog, resultText, toInfo, type McpCallResult, type McpConnection, type McpTarget, type McpTool, type McpToolInfo } from "./hub";
export { isReadTool, nameWords, type McpToolAnnotations, type ReadRule } from "./read-only";
export { GRAFANA_PLUGIN_ID, GRAFANA_RULE, grafanaMcpStatus } from "./grafana";
export { mcpToolName } from "./servers";
export { personMayUse } from "./toolset";
