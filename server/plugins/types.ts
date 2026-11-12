import type { PluginCategory, PluginField, PluginStatus, PluginTool, PluginValues } from "@shared/plugins";

/** What a plugin is given when it starts: its id and its current settings (environment, saved, then the fields' defaults). */
export interface PluginContext {
  id: string;
  values: PluginValues;
  log(message: string): void;
}

/** A started plugin. Everything it registered (tools, subscriptions) is undone by stop(). */
export interface PluginRuntime {
  stop?(): void | Promise<void>;
  /** a cheap check for the Plugins page; called when the page loads, cached briefly */
  status?(): PluginStatus | Promise<PluginStatus>;
  /** a real check for "Test connection"; defaults to status() */
  test?(): PluginStatus | Promise<PluginStatus>;
  /** a tool server's tools and their access, from what it last listed (no request); undefined before it answered */
  catalog?(): PluginTool[] | undefined;
}

export interface PluginDefinition {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  kind: "builtin" | "mcp";
  fields: PluginField[];
  /** cannot be switched off */
  alwaysOn?: boolean;
  /** what it adds, for the Plugins page */
  provides?: { tools?: string[]; features?: string[] };
  /** settings the server's environment pins: they win over saved ones and are not editable */
  fromEnv?(env: NodeJS.ProcessEnv): PluginValues;
  /** on or off before anyone chose, e.g. on when the environment configured it */
  defaultEnabled?(values: PluginValues): boolean;
  /** problems that keep it from starting (a missing URL…); shown as "unconfigured" */
  validate?(values: PluginValues): string[];
  /** turn it on with these settings; called again (after stop) whenever they change */
  start(ctx: PluginContext): PluginRuntime | Promise<PluginRuntime>;
}

/** Makes plugins of an addable kind (an MCP server) from a name and an id. */
export type PluginFactory = (instance: { id: string; name: string }) => PluginDefinition;
