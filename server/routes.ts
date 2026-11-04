import type { Express } from "express";
import type { Server } from "http";
import { registerAiRoutes } from "./ai";
import { registerActionRoutes } from "./action-routes";
import { registerDetailRoutes } from "./detail-routes";
import { registerExecRoutes } from "./exec-routes";
import { registerHomeRoutes } from "./home-routes";
import { runKubectl, runKubectlRaw } from "./kubectl-run";
import { registerLogRoutes } from "./log-routes";
import { registerPodFilesRoutes } from "./pod-files-routes";
import { registerPortForwardRoutes } from "./port-forward-routes";
import { registerResourceRoutes } from "./resource-routes";
import { registerSettingsRoutes } from "./settings-routes";
import { isWebMode } from "./web-mode";

/** Mounts every HTTP route. Each area lives in its own module. */
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  registerResourceRoutes(app);
  registerActionRoutes(app);
  registerPortForwardRoutes(app);
  registerDetailRoutes(app);
  // file browsing runs kubectl exec: never on a shared host
  if (!isWebMode()) registerPodFilesRoutes(app);

  registerSettingsRoutes(app);
  registerExecRoutes(app);
  registerHomeRoutes(app, { runKubectlRaw });
  registerLogRoutes(app, { runKubectl });
  // Web mode has no AI: the endpoints are not even registered, so cluster data cannot reach a model provider.
  if (!isWebMode()) registerAiRoutes(app);

  return httpServer;
}
