/**
 * The assistant's tools are registered, not hard-coded: each module contributes a toolset under its
 * own name, and the agent asks the registry what one call may use. Adding tools never changes the
 * agent loop.
 */
import type { Tool, ToolApprovalStatus } from "ai";
import type { KubeScope } from "./scope";

/** Who is asking, for a toolset deciding what one call gets. */
export interface ToolCallContext {
  scope: KubeScope;
}

/** Decides one call of a tool that may change something: undefined runs it, "user-approval" asks, denied refuses. */
export type ToolApproval = (input: any) => ToolApprovalStatus | undefined;

interface ToolEntryBase {
  // the AI SDK's own tool type; inputs and outputs differ per tool
  tool: Tool<any, any, any>;
  /** The tool runs in the request's cluster scope: it receives the `KubeScope` as its context. */
  scoped?: boolean;
}

/**
 * One tool. A "read" tool (the default) runs without asking; a "change" tool must name the
 * approval policy every call goes through.
 */
export type ToolEntry = ToolEntryBase & ({ risk?: "read"; approval?: never } | { risk: "change"; approval: ToolApproval });

/** What a toolset offers on one call. */
export interface ToolsetCall {
  /** The set's tools switched on for this call; every tool of the set when left out. */
  active?: readonly string[];
  /** Descriptions that replace the registered ones on this call, e.g. a server's live catalog. */
  descriptions?: Readonly<Record<string, string>>;
  /** A system-prompt section for this call; may explain why the tools are off. */
  prompt?: string;
}

export interface Toolset {
  tools: Record<string, ToolEntry>;
  /**
   * Called once per agent call, before the model sees anything: settings and servers can change
   * between requests. Do every lookup the set needs here, once. Leave out to always offer every tool.
   * A toolset that throws is left out of that call.
   */
  forCall?: (ctx: ToolCallContext) => ToolsetCall | Promise<ToolsetCall>;
}

/** Everything one agent call needs from the registry, in registration order. */
export interface ToolsForCall {
  tools: Record<string, Tool<any, any, any>>;
  activeTools: string[];
  /** The scope for every scoped tool. */
  toolsContext: Record<string, KubeScope>;
  toolApproval: Record<string, ToolApproval>;
  promptSections: string[];
}

/** A toolset's answer for one call; a set that throws is left out of that call, not the whole chat. */
async function resolveForCall(owner: string, set: Toolset, ctx: ToolCallContext): Promise<ToolsetCall> {
  if (!set.forCall) return {};
  try {
    return await set.forCall(ctx);
  } catch (err) {
    console.warn(`[kubedeck:agent] tools of ${owner} left out of this call: ${err instanceof Error ? err.message : String(err)}`);
    return { active: [] };
  }
}

/** Add one toolset's answer for this call to what the call gets. */
function addToCall(result: ToolsForCall, set: Toolset, call: ToolsetCall): void {
  const active = call.active ? new Set(call.active) : null;
  for (const [name, entry] of Object.entries(set.tools)) {
    const description = call.descriptions?.[name];
    result.tools[name] = description === undefined ? entry.tool : ({ ...entry.tool, description } as Tool<any, any, any>);
    if (!active || active.has(name)) result.activeTools.push(name);
    if (entry.approval) result.toolApproval[name] = entry.approval;
  }
  if (call.prompt) result.promptSections.push(call.prompt);
}

export class ToolRegistry {
  /** owner → toolset, in registration order */
  private readonly sets = new Map<string, Toolset>();
  /** tool name → owner */
  private readonly owners = new Map<string, string>();

  /** Add a module's tools. Throws when the owner or any tool name is already registered. */
  registerTools(owner: string, set: Toolset): void {
    if (this.sets.has(owner)) throw new Error(`Tools of "${owner}" are already registered`);
    for (const [name, entry] of Object.entries(set.tools)) {
      const taken = this.owners.get(name);
      if (taken) throw new Error(`Tool "${name}" of "${owner}" is already registered by "${taken}"`);
      if (entry.risk === "change" && typeof entry.approval !== "function") throw new Error(`Tool "${name}" changes things but has no approval policy`);
    }
    this.sets.set(owner, set);
    for (const name of Object.keys(set.tools)) this.owners.set(name, owner);
  }

  /** Remove a module's tools, e.g. an MCP server that was disconnected. */
  unregisterTools(owner: string): void {
    const set = this.sets.get(owner);
    if (!set) return;
    for (const name of Object.keys(set.tools)) this.owners.delete(name);
    this.sets.delete(owner);
  }

  /** Every registered tool with its registered description: for validating a chat's history. */
  allTools(): Record<string, Tool<any, any, any>> {
    return Object.fromEntries(this.entries().map(([name, e]) => [name, e.tool]));
  }

  /** What one call gets: every tool (inactive ones stay known for history), the active names, approvals and prompt sections. */
  async toolsForCall(ctx: ToolCallContext): Promise<ToolsForCall> {
    const owned = [...this.sets];
    const calls = await Promise.all(owned.map(([owner, set]) => resolveForCall(owner, set, ctx)));
    const result: ToolsForCall = { tools: {}, activeTools: [], toolsContext: this.toolsContext(ctx.scope), toolApproval: {}, promptSections: [] };
    owned.forEach(([, set], i) => addToCall(result, set, calls[i]));
    return result;
  }

  private entries(): [string, ToolEntry][] {
    return [...this.sets.values()].flatMap((set) => Object.entries(set.tools));
  }

  /** The context map for one request: every scoped tool gets the same scope. */
  private toolsContext(scope: KubeScope): Record<string, KubeScope> {
    return Object.fromEntries(this.entries().filter(([, e]) => e.scoped).map(([name]) => [name, scope]));
  }
}

/** The assistant's registry. Modules register into it when they are imported. */
export const toolRegistry = new ToolRegistry();
