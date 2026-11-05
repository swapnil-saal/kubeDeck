import type { Express } from "express";
import type { Server } from "http";
import { registerAiRoutes } from "./ai";
import { registerActionRoutes } from "./action-routes";
import { registerAccessRoutes } from "./access-routes";
import { registerMapRoutes } from "./map-routes";
import { registerGenericRoutes } from "./generic-routes";
import { registerDetailRoutes } from "./detail-routes";
import { registerExecRoutes } from "./exec-routes";
import { registerHomeRoutes } from "./home-routes";
import { runKubectl, runKubectlRaw } from "./kubectl-run";
import { registerLogRoutes } from "./log-routes";
import { registerPodFilesRoutes } from "./pod-files-routes";
import { registerPortForwardRoutes } from "./port-forward-routes";
import { registerResourceRoutes } from "./resource-routes";
import { registerSettingsRoutes } from "./settings-routes";

/** Mounts every HTTP route. Each area lives in its own module. */
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  registerResourceRoutes(app);
  registerActionRoutes(app);
  registerPortForwardRoutes(app);
  registerDetailRoutes(app);
  registerGenericRoutes(app);
  registerAccessRoutes(app);
  registerMapRoutes(app);
  // web mode can switch pod files and AI off: see webFeatureOff
  registerPodFilesRoutes(app);

  registerSettingsRoutes(app);
  registerExecRoutes(app);
  registerHomeRoutes(app, { runKubectlRaw });
  registerLogRoutes(app, { runKubectl });
  registerAiRoutes(app);

  return httpServer;
}
