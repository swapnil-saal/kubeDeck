/**
 * Running kubectl for the HTTP routes. Never through a shell: route parameters are interpolated
 * into these commands (and validated in security.ts).
 */
import type { Response } from "express";
import { spawn } from "child_process";
import { getKubeconfigEnv } from "./settings";
import { asUser } from "./identity";

// ═══════════════════════════════════════════════════
//  KUBECTL HELPERS
// ═══════════════════════════════════════════════════

export interface KubectlResult {
  items: any[];
  _forbidden?: boolean;
  _error?: string;
  [key: string]: any;
}

export function spawnCommand(cmd: string, args: string[], envOverride?: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, asUser(cmd, args), envOverride ? { env: { ...process.env, ...envOverride } } : undefined);
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    proc.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdoutChunks).toString("utf-8"), stderr: Buffer.concat(stderrChunks).toString("utf-8"), code: code ?? 1 });
    });
    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

export async function runKubectl(command: string): Promise<KubectlResult> {
  // fail in seconds when a cluster is unreachable (kubectl would otherwise wait ~30s per call)
  const args = command.trim().split(/\s+/).concat("-o", "json", "--request-timeout=20s");
  const { stdout, stderr, code } = await spawnCommand("kubectl", args, getKubeconfigEnv());
  if (code !== 0) {
    const combined = `${stderr} ${stdout}`.toLowerCase();
    if (combined.includes("forbidden")) {
      const missing = missingPermission(stderr);
      return { items: [], _forbidden: true, _error: `Access denied: ${missing ?? `kubectl ${command.split(" ").slice(0, 3).join(" ")}`}` };
    }
    if (combined.includes("no resources found") || combined.includes("not found")) {
      return { items: [] };
    }
    throw new Error(stderr.substring(0, 200) || `kubectl exited with code ${code}`);
  }
  try { return JSON.parse(stdout); } catch {
    throw new Error("Failed to parse kubectl output");
  }
}

/** Run kubectl with plain arguments. Never through a shell: callers interpolate request parameters. */
export async function runKubectlRaw(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return spawnCommand("kubectl", command.trim().split(/\s+/), getKubeconfigEnv());
}

export function getNamespaceFlag(ns: string | undefined): string {
  if (!ns || ns === "all" || ns === "") return "-A";
  return `-n ${ns}`;
}

/** "cannot list resource "resourcequotas" in … namespace "e2"" → what the account is missing, in words. */
export function missingPermission(stderr: string): string | null {
  const m = stderr.match(/cannot (\w+) resource "([^"]+)"(?: in API group "([^"]*)")?(?: in the namespace "([^"]+)")?/);
  if (!m) return null;
  const [, verb, resource, group, ns] = m;
  return `this account cannot ${verb} ${group ? `${resource}.${group}` : resource}${ns ? ` in namespace ${ns}` : ""}`;
}

export function handleForbidden(res: Response, stderr: string, fallbackMsg: string) {
  if (stderr.toLowerCase().includes("forbidden")) {
    const missing = missingPermission(stderr);
    return res.status(403).json({ message: missing ? `${fallbackMsg}: ${missing}` : fallbackMsg });
  }
  return res.status(500).json({ message: stderr || fallbackMsg });
}

export function selectorToString(selector: Record<string, string>): string {
  return Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(",");
}
