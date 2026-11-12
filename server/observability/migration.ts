/**
 * Once: the desktop's old Settings → Observability values (the `observability` block of
 * ~/.kubedeck/settings.json) become the Tempo, Loki and Grafana plugins' settings. A plugin that
 * already has saved choices is left alone, so this runs at most once per plugin.
 */
import type { PluginValues } from "@shared/plugins";
import { PluginError, updatePlugin, type PluginStore } from "../plugins";
import { pluginValuesOf } from "./settings";

const BY = "migration";

/**
 * Carry the legacy settings into the plugins that have no saved row yet; each is on when it got a URL.
 * Call right after startPlugins. Returns the ids of the plugins it configured.
 */
export async function migrateObservability(store: PluginStore, legacy: Record<string, unknown> | undefined): Promise<string[]> {
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) return [];
  const saved = new Set((await store.all()).map((r) => r.id));
  const done: string[] = [];
  for (const [id, values] of Object.entries(pluginValuesOf(legacy))) {
    if (!saved.has(id) && Object.keys(values).length > 0 && (await carryOver(id, values))) done.push(id);
  }
  if (done.length) console.log(`[kubedeck] moved the Observability settings into Settings → Plugins (${done.join(", ")})`);
  return done;
}

/** Save one plugin's old values, on when they have a URL. False when the plugin does not exist or refused them. */
async function carryOver(id: string, values: PluginValues): Promise<boolean> {
  try {
    await updatePlugin(id, { enabled: !!values.url, values }, BY);
    return true;
  } catch (err) {
    // "grafana" is defined by the MCP plugins; where it is not (yet), its values stay in the file
    if (!(err instanceof PluginError && err.status === 404)) {
      console.warn(`[kubedeck] could not carry the old ${id} settings into Settings → Plugins: ${err instanceof Error ? err.message : err}`);
    }
    return false;
  }
}
