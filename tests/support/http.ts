/** A real HTTP server for a test's Express app, and a small JSON client for it. */
import type { Express } from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

export interface TestServer {
  base: string;
  /** send a request (a JSON body when given) and read the JSON answer */
  send(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function listen(app: Express): Promise<TestServer> {
  const server = await new Promise<Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    async send(method, path, body, headers = {}) {
      const r = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await r.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: parsed };
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
