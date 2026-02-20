import type { Express } from "express";
import { type Server } from "http";
import { exec } from "child_process";
import { promisify } from "util";
import { api } from "@shared/routes";

const execAsync = promisify(exec);

async function runKubectl(command: string): Promise<any> {
  try {
    const { stdout } = await execAsync(`kubectl ${command} -o json`);
    return JSON.parse(stdout);
  } catch (error: any) {
    console.error(`Kubectl error (${command}):`, error.message);
    throw new Error(`Failed to execute kubectl ${command}`);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Replit environment fallback
  const isReplit = process.env.REPL_ID !== undefined;

  app.get(api.k8s.contexts.path, async (req, res) => {
    try {
      if (isReplit) {
        return res.json([
          { name: "minikube", cluster: "minikube", user: "minikube", isCurrent: true },
          { name: "docker-desktop", cluster: "docker-desktop", user: "docker-desktop", isCurrent: false }
        ]);
      }
      
      const { stdout } = await execAsync(`kubectl config get-contexts -o name`);
      const contexts = stdout.trim().split('\n').filter(Boolean);
      
      const { stdout: current } = await execAsync(`kubectl config current-context`);
      const currentContext = current.trim();

      const result = contexts.map(name => ({
        name,
        cluster: name,
        user: name,
        isCurrent: name === currentContext
      }));
      
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.get(api.k8s.namespaces.path, async (req, res) => {
    try {
      if (isReplit) {
        return res.json([
          { name: "default", status: "Active", age: "10d" },
          { name: "kube-system", status: "Active", age: "10d" }
        ]);
      }

      const context = req.query.context ? `--context=${req.query.context}` : '';
      const data = await runKubectl(`get namespaces ${context}`);
      
      const result = data.items.map((item: any) => ({
        name: item.metadata.name,
        status: item.status?.phase || "Unknown",
        age: item.metadata.creationTimestamp
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.get(api.k8s.pods.path, async (req, res) => {
    try {
      if (isReplit) {
        return res.json([
          { name: "nginx-12345", namespace: "default", status: "Running", restarts: 0, age: "2d", node: "node-1" },
          { name: "api-gateway-xyz", namespace: "default", status: "CrashLoopBackOff", restarts: 5, age: "1d", node: "node-2" },
          { name: "redis-master-0", namespace: "default", status: "Running", restarts: 1, age: "5d", node: "node-1" }
        ]);
      }

      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace && req.query.namespace !== 'All Namespaces' ? `-n ${req.query.namespace}` : '-A';
      const data = await runKubectl(`get pods ${context} ${namespace}`);

      const result = data.items.map((item: any) => ({
        name: item.metadata.name,
        namespace: item.metadata.namespace,
        status: item.status?.phase || "Unknown",
        restarts: item.status?.containerStatuses?.[0]?.restartCount || 0,
        age: item.metadata.creationTimestamp,
        node: item.spec?.nodeName || "Unknown"
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.get(api.k8s.deployments.path, async (req, res) => {
    try {
      if (isReplit) {
        return res.json([
          { name: "nginx-deployment", namespace: "default", ready: "2/2", upToDate: "2", available: "2", age: "2d" },
          { name: "api-gateway", namespace: "default", ready: "0/3", upToDate: "3", available: "0", age: "1d" }
        ]);
      }

      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace && req.query.namespace !== 'All Namespaces' ? `-n ${req.query.namespace}` : '-A';
      const data = await runKubectl(`get deployments ${context} ${namespace}`);

      const result = data.items.map((item: any) => ({
        name: item.metadata.name,
        namespace: item.metadata.namespace,
        ready: `${item.status?.readyReplicas || 0}/${item.spec?.replicas || 0}`,
        upToDate: String(item.status?.updatedReplicas || 0),
        available: String(item.status?.availableReplicas || 0),
        age: item.metadata.creationTimestamp
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.get(api.k8s.services.path, async (req, res) => {
    try {
      if (isReplit) {
        return res.json([
          { name: "kubernetes", namespace: "default", type: "ClusterIP", clusterIP: "10.96.0.1", ports: "443/TCP", age: "10d" },
          { name: "nginx-svc", namespace: "default", type: "NodePort", clusterIP: "10.100.20.5", ports: "80:31234/TCP", age: "2d" }
        ]);
      }

      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace && req.query.namespace !== 'All Namespaces' ? `-n ${req.query.namespace}` : '-A';
      const data = await runKubectl(`get services ${context} ${namespace}`);

      const result = data.items.map((item: any) => {
        const ports = item.spec?.ports?.map((p: any) => {
          if (p.nodePort) {
            return `${p.port}:${p.nodePort}/${p.protocol}`;
          }
          return `${p.port}/${p.protocol}`;
        }).join(", ") || "";
        
        return {
          name: item.metadata.name,
          namespace: item.metadata.namespace,
          type: item.spec?.type || "Unknown",
          clusterIP: item.spec?.clusterIP || "None",
          ports: ports,
          age: item.metadata.creationTimestamp
        };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.delete(`${api.k8s.podDelete.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : '';
      
      if (isReplit) {
        return res.json({ message: `Pod ${name} deleted (mock)` });
      }

      await execAsync(`kubectl delete pod ${name} ${context} ${namespace}`);
      res.json({ message: `Pod ${name} deleted` });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.get(`${api.k8s.podLogs.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : '';

      if (isReplit) {
        return res.json({ logs: `[MOCK LOGS for ${name}]\n2026-02-20T07:30:00Z INFO Initializing...\n2026-02-20T07:30:01Z INFO Ready to serve requests.\n2026-02-20T07:35:12Z DEBUG Processing request ID 550e8400-e29b-41d4-a716-446655440000` });
      }

      const { stdout } = await execAsync(`kubectl logs ${name} ${context} ${namespace} --tail=100`);
      res.json({ logs: stdout });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.get(`${api.k8s.podEnv.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : '';

      if (isReplit) {
        return res.json({ env: `KUBERNETES_SERVICE_HOST=10.96.0.1\nKUBERNETES_SERVICE_PORT=443\nNODE_NAME=node-1\nPOD_IP=10.244.0.5\nAPP_VERSION=v1.2.3` });
      }

      const { stdout } = await execAsync(`kubectl exec ${name} ${context} ${namespace} -- env`);
      res.json({ env: stdout });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  app.post(`${api.k8s.portForward.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const { port } = api.k8s.portForward.input.parse(req.body);
      const context = req.query.context ? `--context=${req.query.context}` : '';
      const namespace = req.query.namespace ? `-n ${req.query.namespace}` : '';

      if (isReplit) {
        return res.json({ message: `Port forwarding started for ${name} on port ${port} (mock)` });
      }

      // Note: kubectl port-forward is usually a long-running process. 
      // In a real app, we might want to manage these processes.
      // For this quick tool, we'll just trigger it and let it run in background if possible, 
      // but standard exec might hang. Usually we'd use a spawn or a manager.
      exec(`kubectl port-forward ${name} ${port}:${port} ${context} ${namespace} &`);
      res.json({ message: `Port forward command issued for ${name} on port ${port}` });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  return httpServer;
}
