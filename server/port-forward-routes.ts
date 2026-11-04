/**
 * Port forwards started from the UI: start, list, stop. The processes live as long as the server.
 */
import type { Express } from "express";
import { spawn, type ChildProcess } from "child_process";
import * as net from "net";
import { randomUUID } from "crypto";
import { api } from "@shared/routes";
import { getKubeconfigEnv } from "./settings";

/** Quick TCP connect test — resolves true if something is listening on host:port */
function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => { sock.destroy(); resolve(false); });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(false); });
  });
}

// ═══════════════════════════════════════════════════
//  PORT FORWARD STATE
// ═══════════════════════════════════════════════════

interface PortForwardRecord {
  id: string;
  pod: string;
  namespace: string;
  context: string;
  localPort: number;
  remotePort: number;
  startedAt: string;
  process: ChildProcess;
  status: "active" | "dead" | "error";
  error?: string;
  connections: number;          // how many "Handling connection for" lines seen
}

const activePortForwards = new Map<string, PortForwardRecord>();

function cleanupDeadForwards() {
  const ids = Array.from(activePortForwards.keys());
  for (const id of ids) {
    const rec = activePortForwards.get(id)!;
    if (rec.process.killed || rec.process.exitCode !== null) {
      activePortForwards.delete(id);
    }
  }
}


export function registerPortForwardRoutes(app: Express): void {
  // ═══════════════════════════════════════════════════
  //  PORT FORWARD (with tracking)
  // ═══════════════════════════════════════════════════

  app.post(`${api.k8s.portForward.path}`, async (req, res) => {
    try {
      const { name } = req.params;
      const parsed = api.k8s.portForward.input.parse(req.body);
      const localPort = parsed.port;
      const remotePort = parsed.remotePort || localPort;
      const context = req.query.context ? String(req.query.context) : "";
      const namespace = req.query.namespace ? String(req.query.namespace) : "";


      // Check if the local port is already in use by an existing forward
      cleanupDeadForwards();
      for (const [, rec] of activePortForwards) {
        if (rec.localPort === localPort) {
          return res.status(409).json({ message: `Port ${localPort} is already in use by forward to ${rec.pod}` });
        }
      }

      // Build args — no --address flag so kubectl binds to localhost (IPv4 + IPv6)
      const spawnArgs: string[] = ["port-forward", name, `${localPort}:${remotePort}`];
      if (context) spawnArgs.push(`--context=${context}`);
      if (namespace) spawnArgs.push("-n", namespace);


      const pfKubeconfigEnv = getKubeconfigEnv();
      const pfEnv = Object.keys(pfKubeconfigEnv).length > 0 ? { ...process.env, ...pfKubeconfigEnv } : undefined;
      const proc = spawn("kubectl", spawnArgs, { stdio: ["pipe", "pipe", "pipe"], env: pfEnv });
      const id = randomUUID().slice(0, 8);

      // Create record immediately so we can track status
      const record: PortForwardRecord = {
        id, pod: name, namespace, context, localPort, remotePort,
        startedAt: new Date().toISOString(), process: proc,
        status: "active", connections: 0,
      };

      // Wait for kubectl to confirm "Forwarding from ..." or fail
      const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
        let stderrBuf = "";
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({ ok: true, message: `Port forward started (waiting for kubectl confirmation timed out, may still be connecting)` });
          }
        }, 8000);

        proc.stdout!.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          // kubectl prints "Forwarding from 127.0.0.1:XXXX -> YYYY" when ready
          if (!settled && text.includes("Forwarding from")) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: true, message: `Forwarding established: localhost:${localPort} → ${name}:${remotePort}` });
          }

          // Count "Handling connection" lines
          const matches = text.match(/Handling connection/g);
          if (matches) {
            record.connections += matches.length;
          }
        });

        proc.stderr!.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          stderrBuf += text;

          // Some kubectl versions print "Forwarding from" on stderr
          if (!settled && text.includes("Forwarding from")) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: true, message: `Forwarding established: localhost:${localPort} → ${name}:${remotePort}` });
          }
        });

        proc.on("close", (code) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            const errMsg = stderrBuf.trim() || `kubectl port-forward exited with code ${code}`;
            resolve({ ok: false, message: errMsg });
          }
          // Update status after promise resolved
          record.status = "dead";
          record.error = stderrBuf.trim() || `Exited with code ${code}`;
        });

        proc.on("error", (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve({ ok: false, message: `Failed to start kubectl: ${err.message}` });
          }
          record.status = "error";
          record.error = err.message;
        });
      });

      if (!result.ok) {
        try { proc.kill(); } catch {}
        return res.status(500).json({ message: result.message });
      }

      activePortForwards.set(id, record);
      // Verify the port is actually reachable (non-blocking — log result)
      setTimeout(async () => {
        const ok = await tcpProbe("127.0.0.1", localPort, 3000);
        if (!ok) {
          record.error = `Port ${localPort} not reachable after forward established`;
        }
      }, 500);

      res.json({ message: result.message, id });
    } catch (err) { res.status(500).json({ message: String(err) }); }
  });

  app.get(api.k8s.portForwards.path, (_req, res) => {
    cleanupDeadForwards();
    const entries = Array.from(activePortForwards.values()).map(r => {
      // Double-check liveness
      const alive = r.process.exitCode === null && !r.process.killed;
      return {
        id: r.id, pod: r.pod, namespace: r.namespace, context: r.context,
        localPort: r.localPort, remotePort: r.remotePort, startedAt: r.startedAt,
        status: alive ? "active" : "dead",
        error: r.error,
        connections: r.connections,
      };
    });
    res.json(entries);
  });

  app.delete(api.k8s.portForwardStop.path, (req, res) => {
    const { id } = req.params;
    const record = activePortForwards.get(id);
    if (!record) return res.status(404).json({ message: "Port forward not found (may have already stopped)" });
    try {
      record.process.kill("SIGTERM");
      // Force kill after 2s if still alive
      setTimeout(() => { try { record.process.kill("SIGKILL"); } catch {} }, 2000);
    } catch {}
    activePortForwards.delete(id);
    res.json({ message: `Port forward ${id} stopped (${record.pod}:${record.localPort})` });
  });
}
