/** The assistant's tool registry: modules register their tools here, the agent asks it what one call may use. */
import { toolRegistry } from "./registry";

export const registerTools = toolRegistry.registerTools.bind(toolRegistry);
export const unregisterTools = toolRegistry.unregisterTools.bind(toolRegistry);
export const allTools = toolRegistry.allTools.bind(toolRegistry);
export const toolsForCall = toolRegistry.toolsForCall.bind(toolRegistry);
export { ToolRegistry, type ToolApproval, type ToolCallContext, type ToolEntry, type Toolset, type ToolsetCall, type ToolsForCall } from "./registry";
export { kubeScopeSchema, type KubeScope } from "./scope";
export { proxyTool, type ProxyToolOptions } from "./proxy";
