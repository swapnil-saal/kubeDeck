/**
 * The Tempo traces and Loki logs plugins. Settings → Plugins (or the server's environment, which wins)
 * configures them; getObservability() reads what they hold.
 */
import type { PluginStatus, PluginValues } from "@shared/plugins";
import { definePlugin, type PluginRuntime } from "../plugins";
import { lokiLabels } from "../loki";
import { tagValues } from "../tempo";
import { nonEmpty, observabilityOf, parseClusterMap, text } from "./settings";

const HTTP_URL = /^https?:\/\/[^\s]+$/;
/** A runtime whose status is a check against the service: ok (with what the check reports), or the error. */
const checkedBy = (check: () => Promise<string | undefined>): PluginRuntime => ({
  async status(): Promise<PluginStatus> {
    try {
      const detail = await check();
      return detail ? { state: "ok", detail } : { state: "ok" };
    } catch (err) {
      return { state: "error", message: err instanceof Error ? err.message : String(err) };
    }
  },
});

/** Problems with the URL fields: the required one missing, any of them not http(s). */
function urlProblems(v: PluginValues, required: string, optional: string[] = []): string[] {
  const problems: string[] = [];
  if (!text(v[required])) problems.push("Set the URL.");
  for (const key of [required, ...optional]) {
    const url = text(v[key]);
    if (url && !HTTP_URL.test(url)) problems.push(`"${url}" is not an http(s) URL.`);
  }
  return problems;
}

definePlugin({
  id: "tempo",
  name: "Tempo traces",
  description: "Traces from Grafana Tempo: the workload Traces tab, Overview → Traces, and the assistant's trace tools.",
  category: "observability",
  kind: "builtin",
  fields: [
    { key: "url", label: "Tempo URL", kind: "url", required: true, placeholder: "https://tempo.example.com", help: "Tempo's HTTP API." },
    { key: "token", label: "Token", kind: "secret", help: "Sent as a bearer token, when Tempo needs one." },
    { key: "tenant", label: "Tenant", kind: "text", help: "Sent as X-Scope-OrgID, for a multi-tenant Tempo." },
    {
      key: "clusters", label: "Clusters", kind: "map",
      help: "Kube context → the k8s.cluster.name its traces carry, where KubeDeck cannot tell (in a cluster the context is in-cluster).",
    },
    { key: "grafanaUrl", label: "Grafana URL", kind: "url", placeholder: "https://grafana.example.com", help: "For \"Open in Grafana\" on a trace, with the data source below." },
    { key: "grafanaTempoDatasource", label: "Grafana Tempo data source", kind: "text", help: "The Tempo data source's uid in Grafana, for \"Open in Grafana\" on a trace." },
  ],
  fromEnv: (env) => nonEmpty({
    url: (env.KUBEDECK_TEMPO_URL ?? "").trim(),
    token: env.KUBEDECK_TEMPO_TOKEN ?? "",
    tenant: (env.KUBEDECK_TEMPO_TENANT ?? "").trim(),
    clusters: parseClusterMap(env.KUBEDECK_TEMPO_CLUSTERS),
    grafanaUrl: (env.KUBEDECK_GRAFANA_URL ?? "").trim(),
    grafanaTempoDatasource: (env.KUBEDECK_GRAFANA_TEMPO_DATASOURCE ?? "").trim(),
  }),
  defaultEnabled: (v) => !!text(v.url),
  validate: (v) => urlProblems(v, "url", ["grafanaUrl"]),
  provides: { tools: ["traces_stats", "traces_search", "trace_get"], features: ["Traces tab", "Overview → Traces"] },
  start(ctx) {
    const o = observabilityOf({ tempo: ctx.values });
    return checkedBy(async () => {
      const clusters = await tagValues(o, "resource.k8s.cluster.name", undefined, "24h");
      return `${clusters.length} ${clusters.length === 1 ? "cluster" : "clusters"}`;
    });
  },
});

definePlugin({
  id: "loki",
  name: "Loki logs",
  description: "Log history from Grafana Loki: a pod's lines next to a traced request, and logs of pods that are gone for the assistant.",
  category: "observability",
  kind: "builtin",
  fields: [
    { key: "url", label: "Loki URL", kind: "url", required: true, placeholder: "https://loki.example.com", help: "Loki's HTTP API." },
    { key: "token", label: "Token", kind: "secret", help: "Sent as a bearer token, when Loki needs one." },
    { key: "tenant", label: "Tenant", kind: "text", help: "Sent as X-Scope-OrgID, for a multi-tenant Loki." },
  ],
  fromEnv: (env) => nonEmpty({
    url: (env.KUBEDECK_LOKI_URL ?? "").trim(),
    token: env.KUBEDECK_LOKI_TOKEN ?? "",
    tenant: (env.KUBEDECK_LOKI_TENANT ?? "").trim(),
  }),
  defaultEnabled: (v) => !!text(v.url),
  validate: (v) => urlProblems(v, "url"),
  provides: { tools: ["logs_search"], features: ["Log lines next to traces"] },
  start(ctx) {
    const o = observabilityOf({ loki: ctx.values });
    return checkedBy(async () => {
      await lokiLabels(o);
      return undefined;
    });
  },
});
