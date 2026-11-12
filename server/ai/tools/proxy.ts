/**
 * A proxy tool: one assistant tool that forwards `{tool, arguments}` to a named tool of another
 * system (an MCP server). The model sees one tool whose per-call description lists what it may call,
 * which keeps its context small however many tools the server has.
 */
import { tool } from "ai";
import { z } from "zod";
import { kubeScopeSchema, type KubeScope } from "./scope";

export interface ProxyToolOptions {
  /** the registered description; a toolset usually replaces it per call with the live list */
  description: string;
  /** what a tool name must look like */
  namePattern: RegExp;
  /** how the `tool` parameter is described to the model */
  nameHint: string;
  /** forward one call; whatever it returns (or throws, as text) is what the model reads */
  run(name: string, args: Record<string, unknown>, call: { scope: KubeScope; signal?: AbortSignal }): Promise<string>;
}

export function proxyTool(o: ProxyToolOptions) {
  return tool({
    description: o.description,
    inputSchema: z.object({
      tool: z.string().regex(o.namePattern).describe(o.nameHint),
      arguments: z.record(z.string(), z.unknown()).optional().describe("The tool's arguments as an object"),
    }),
    contextSchema: kubeScopeSchema,
    execute: async ({ tool: name, arguments: args }, { abortSignal, context }) => {
      try {
        return await o.run(name, args ?? {}, { scope: context, signal: abortSignal });
      } catch (err) {
        if (abortSignal?.aborted) throw err;
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
