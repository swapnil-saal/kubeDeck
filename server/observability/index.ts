/**
 * Observability: the Tempo traces and Loki logs plugins (defined when this module loads), the
 * settings they put in effect, and the one-time move of the desktop's old Observability settings.
 * Tempo and Loki themselves are reached through server/tempo.ts and server/loki.ts.
 */
import "./plugins";

export { getObservability, parseClusterMap, type ObservabilitySettings } from "./settings";
export { migrateObservability } from "./migration";
