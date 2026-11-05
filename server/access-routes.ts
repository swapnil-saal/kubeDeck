/**
 * What the cluster identity KubeDeck acts as may do, per namespace, so the UI can disable what would
 * be refused. One SelfSubjectRulesReview per namespace (the API behind `kubectl auth can-i --list`),
 * cached for a minute. The API server still decides every request; this only shapes the buttons.
 */
import type { Express } from "express";
import { unlinkSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { api, type Access } from "@shared/routes";
import { spawnCommand } from "./kubectl-run";
import { getKubeconfigEnv } from "./settings";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: Access }>();

/** The review's status → rules (empty lists where the server left fields out). */
export function parseRulesReview(json: string): Access {
  const status = (JSON.parse(json) as { status?: { resourceRules?: any[]; incomplete?: boolean } }).status ?? {};
  return {
    rules: (status.resourceRules ?? []).map((r) => ({
      verbs: r.verbs ?? [],
      apiGroups: r.apiGroups ?? [],
      resources: r.resources ?? [],
      resourceNames: r.resourceNames ?? [],
    })),
    incomplete: !!status.incomplete,
  };
}

export function registerAccessRoutes(app: Express): void {
  app.get(api.k8s.access.path, async (req, res) => {
    const context = typeof req.query.context === "string" ? req.query.context : "";
    const raw = typeof req.query.namespace === "string" ? req.query.namespace : "";
    // "all namespaces" has no single answer; the default namespace stands in for cluster-wide grants
    const namespace = raw && raw !== "all" ? raw : "default";
    const key = `${context}|${namespace}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.data);

    const file = path.join(os.tmpdir(), `kubedeck-ssrr-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({
      apiVersion: "authorization.k8s.io/v1", kind: "SelfSubjectRulesReview", spec: { namespace },
    }), { mode: 0o600 });
    try {
      const r = await spawnCommand(
        "kubectl",
        ["create", "--raw", "/apis/authorization.k8s.io/v1/selfsubjectrulesreviews", "-f", file, "--request-timeout=20s", ...(context ? [`--context=${context}`] : [])],
        getKubeconfigEnv(),
      );
      if (r.code !== 0) return res.status(500).json({ message: r.stderr.trim().slice(0, 200) || "Could not read this account's permissions" });
      const data = parseRulesReview(r.stdout);
      cache.set(key, { at: Date.now(), data });
      res.json(data);
    } catch {
      res.status(500).json({ message: "Could not read this account's permissions" });
    } finally {
      try { unlinkSync(file); } catch { /* already gone */ }
    }
  });
}
