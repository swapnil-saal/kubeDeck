import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { registerParamValidators, requireTrustedRequest, validateK8sQuery } from "./security";
import { reportUnreachableAs503 } from "./errors";
import { ensureInClusterKubeconfig } from "./incluster";
import { auditLog, describeMode, HEALTH_PATH, loadWebConfig, setWebConfig, validateWebConfig, webGate, webReadOnly } from "./web-mode";

// Web (shared-service) mode is opt-in; refuse to start half-configured rather than serve cluster access to anyone.
const webCfg = loadWebConfig();
const webProblems = validateWebConfig(webCfg);
if (webProblems.length > 0) {
  for (const p of webProblems) console.error(`[kubedeck] ${p}`);
  process.exit(1);
}
setWebConfig(webCfg);
if (webCfg.enabled) {
  const kc = ensureInClusterKubeconfig();
  if (kc) console.log(`[kubedeck] running in a pod: using the service account via ${kc}`);
}

const app = express();
const httpServer = createServer(app);

// Pod-spec liveness/readiness probe: answers before any identity or host check, returns no data.
app.get(HEALTH_PATH, (_req, res) => { res.type("text/plain").send("ok"); });

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Every API call (kubectl exec, terminal, AI, settings…) must come from this app's own origin.
app.use("/api", requireTrustedRequest);
// Web mode: pages and API alike need the login proxy's identity; writes are refused when read-only.
app.use(webGate);
app.use(auditLog);
app.use("/api", webReadOnly);
app.get("/api/mode", (req, res) => { res.json(describeMode(req)); });
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
  await registerRoutes(httpServer, app);

  // An unknown API path is a 404, not the single-page app's index.html (which answered 200 to anything).
  app.use("/api", (_req, res) => { res.status(404).json({ message: "Not found" }); });

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
