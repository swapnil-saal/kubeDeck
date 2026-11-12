/**
 * Plugins: built-in ones (defined with definePlugin when their module loads) and ones an admin adds
 * (an MCP server, made by its kind's factory). The rest of KubeDeck reads a plugin's state with
 * pluginState(id); the Plugins page uses the routes. This module owns the `plugin_state` table.
 */
import "./kubernetes";

export { addableKinds, createPlugin, definePlugin, definePluginKind, getPlugin, listPlugins, pluginState, PluginError, removePlugin, startPlugins, stopPlugins, testPlugin, updatePlugin } from "./manager";
export { registerPluginRoutes } from "./routes";
export { databaseStore, memoryStore, type PluginStore, type StoredPlugin } from "./store";
export type { PluginContext, PluginDefinition, PluginFactory, PluginRuntime } from "./types";
