import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveDocs, serveStatic } from "./static";
import { createServer } from "http";
import { registerParamValidators, requireTrustedRequest, validateK8sQuery } from "./security";
import { reportUnreachableAs503 } from "./errors";
import fs from "fs";
import os from "os";
import path from "path";
import { bindIdentity, setClusterGrants } from "./identity";
import {
  auditLog, describeMode, HEALTH_PATH, loadWebConfig, RETIRED_SETTINGS, setPermissionResolver, setSessionResolver, setWebConfig, validateWebConfig,
  webFeatureOff, webGate, webPermissionGate, webReadOnly,
} from "./web-mode";
import type { KubeDeckAuth } from "./auth";
import { authConfigProblems, loadAuthConfig, mountAuthRoutes, registerAdminRoutes } from "./auth";
import { startAudit } from "./audit";
import { registerAuditRoutes } from "./audit";
import { openAppDatabase } from "./db";
import { databaseStore, memoryStore, registerPluginRoutes, startPlugins } from "./plugins";
import { migrateObservability } from "./observability";
import { legacyAi, legacyObservability } from "./settings";
import { migrateAiSettings } from "./ai/ai-plugin";
import { databaseClusterStore, registerClusterRoutes, startClusters } from "./clusters";
import { adoptGroups, appPermissionsFor, clusterGrantsFor, clustersFor, groupsUsing, databaseGroupStore, groupIds, registerGroupRoutes, startGroups } from "./groups";
import { databaseProjectStore, memoryProjectStore, registerProjectRoutes } from "./projects";

// Web (shared-service) mode is opt-in; refuse to start half-configured rather than serve cluster access to anyone.
const webCfg = loadWebConfig();
const webProblems = [...validateWebConfig(webCfg), ...(webCfg.enabled ? authConfigProblems(loadAuthConfig()) : [])];
if (webProblems.length > 0) {
  for (const p of webProblems) console.error(`[kubedeck] ${p}`);
  process.exit(1);
}
setWebConfig(webCfg);
if (webCfg.enabled) {
  // web mode reads no kubeconfig from this machine: kubectl gets an empty one, and every call names its
  // connection (a cluster's, or a group's) with --kubeconfig (identity.ts)
  const empty = path.join(os.tmpdir(), "kubedeck-no-kubeconfig");
  fs.writeFileSync(empty, "", { mode: 0o600 });
  process.env.KUBECONFIG = empty;
  for (const name of RETIRED_SETTINGS.filter((n) => process.env[n] !== undefined)) {
    console.warn(`[kubedeck] ${name} is no longer used: clusters come from Settings → Clusters and access from Settings → Groups.`);
  }
  console.log("[kubedeck] Clusters come from Settings → Clusters; people reach a cluster through their groups' service accounts (Settings → Groups).");
}

const app = express();
// Behind an ingress or load balancer, the client's address is in X-Forwarded-For; trust only as many
// hops as the operator says are theirs (used for the sign-in rate limit and the audit log)
const proxyHops = Number(process.env.KUBEDECK_PROXY_HOPS ?? 0);
if (Number.isInteger(proxyHops) && proxyHops > 0) app.set("trust proxy", proxyHops);
const httpServer = createServer(app);

// Pod-spec liveness/readiness probe: answers before any identity or host check, returns no data.
app.get(HEALTH_PATH, (_req, res) => { res.type("text/plain").send("ok"); });

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Every API call (kubectl, file browsing, AI, settings…) must come from this app's own origin.
app.use("/api", requireTrustedRequest);
// Who is asking: on the desktop the local user; in web mode the API needs a signed-in person (the
// sign-in page and the app's files do not). Every write is then audited; writes are refused when read-only.
app.use(webGate);
app.use(auditLog);
// KubeDeck's sign-in. Before the body parsers, which would consume what
// Better Auth reads. Its admin routes are not reachable from outside: admins use /api/admin (validated).
let builtinAuth: KubeDeckAuth | null = null;
if (webCfg.enabled) mountAuthRoutes(app, () => builtinAuth);
app.use("/api", webFeatureOff);
app.use("/api", webPermissionGate);
app.use("/api", webReadOnly);
// whether the audit log is kept: set once the database has opened (or failed to, on the desktop)
let auditReady = false;
app.get("/api/mode", (req, res) => { res.json(describeMode(req, { audit: auditReady })); });
app.use("/api/k8s", validateK8sQuery);
app.use("/api/k8s", reportUnreachableAs503);
registerParamValidators(app);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
// after body parsing: a parser resumes the chain from a stream event, which would lose the identity's async context
app.use(bindIdentity);

export function log(message: string, source = "express") {
  if (process.env.KUBEDECK_DEBUG !== "1") return;
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  if (process.env.KUBEDECK_DEBUG !== "1") return next();

  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // The database keeps the audit log in both modes, and web mode's accounts and sessions. Web mode
  // cannot run without it; the desktop app only loses its audit log.
  const d = await openAppDatabase({ required: webCfg.enabled }).catch((err) => {
    console.error(`[kubedeck] Web mode cannot start without its database: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
  if (d) startAudit(d);
  auditReady = d !== null;
  registerAuditRoutes(app, d);
  // Web mode: KubeDeck's own sign-in and user management (Better Auth is never loaded on the desktop)
  if (webCfg.enabled && d) {
    const { startAuth } = await import("./auth");
    const a = await startAuth(d, loadAuthConfig());
    builtinAuth = a;
    setSessionResolver((req) => a.userOf(req));
    // groups (Settings → Groups): defined here, joined on each account; groups accounts already carry are adopted once
    await startGroups(databaseGroupStore(d));
    const adopted = await adoptGroups([...(await a.groupMembers()).keys()], "startup");
    if (adopted.length) console.log(`[kubedeck] Defined the groups accounts already had: ${adopted.join(", ")}.`);
    registerAdminRoutes(app, a, { knownGroups: groupIds });
    setPermissionResolver(appPermissionsFor);
    registerGroupRoutes(app, { members: async (id) => (await a.groupMembers()).get(id) ?? 0 });
    // clusters (Settings → Clusters) and every kubectl call: the person's groups' service accounts on its cluster, in order
    await startClusters(databaseClusterStore(d));
    registerClusterRoutes(app, { usedBy: groupsUsing });
    setClusterGrants((person, context) => clusterGrantsFor(person.groups, context), (person) => clustersFor(person.groups));
  }
  // projects: in the database on the desktop and in web mode (memory for this run without one)
  registerProjectRoutes(app, d ? databaseProjectStore(d) : memoryProjectStore());
  // Plugins (Settings → Plugins): their choices live in the database; without one, in memory for this run
  const pluginStore = d ? databaseStore(d) : memoryStore();
  await startPlugins(pluginStore);
  // once: the desktop's old Settings → Observability values become the Tempo / Loki / Grafana plugins'
  await migrateObservability(pluginStore, legacyObservability());
  await migrateAiSettings(pluginStore, legacyAi());
  registerPluginRoutes(app);

  await registerRoutes(httpServer, app);

  // An unknown API path is a 404, not the single-page app's index.html (which answered 200 to anything).
  app.use("/api", (_req, res) => { res.status(404).json({ message: "Not found" }); });
  serveDocs(app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (process.env.KUBEDECK_DEBUG === "1") {
      console.error("Internal Server Error:", err);
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // Desktop: loopback only — this server can run kubectl and open a shell. Web mode must be reachable by the proxy.
  const host = process.env.HOST || (webCfg.enabled ? "0.0.0.0" : "127.0.0.1");
  httpServer.listen(
    { port, host },
    () => {
      log(`serving on ${host}:${port}`);
    },
  );
})();
