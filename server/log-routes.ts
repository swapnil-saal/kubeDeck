import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { Express, Request, Response } from "express";
import { getKubeconfigEnv } from "./settings";
import { resolveTargets } from "./log-fetch";
import { LOG_KINDS, LineSplitter, logArgs, parseStreamOptions, planStreams, type LogKind } from "./log-stream";

export interface LogRouteDeps {
  /** `kubectl get … -o json` with Forbidden mapped to `_forbidden` */
  runKubectl: (command: string) => Promise<any>;
}

const KA_MS = 20_000;
const DISCOVERY_MS = 8_000;
const NEW_POD_TAIL = 50;

const csv = (v: unknown): string[] | undefined =>
  typeof v === "string" && v ? v.split(",").filter(Boolean) : undefined;

export function registerLogRoutes(app: Express, { runKubectl }: LogRouteDeps): void {
  const kindOf = (req: Request): LogKind => (LOG_KINDS.includes(req.query.kind as LogKind) ? (req.query.kind as LogKind) : "pod");

  // Which pods (and containers) belong to this workload / service? Lets the UI offer a pod picker.
  app.get("/api/k8s/logs/targets", async (req: Request, res: Response) => {
    const name = String(req.query.name ?? "");
    if (!name) return res.status(400).json({ message: "Missing name" });
    const r = await resolveTargets(runKubectl, kindOf(req), name, String(req.query.context ?? ""), String(req.query.namespace ?? ""));
    if (!r.ok) return res.status(r.reason === "forbidden" ? 403 : r.reason === "not-found" ? 404 : 422).json({ message: r.message, reason: r.reason });
    res.json({ kind: kindOf(req), selector: r.selector, pods: r.pods });
  });

  // One SSE connection carrying every selected pod/container: {t:"meta"|"line"|"pods"|"gone"|"err"|"end"}.
  app.get("/api/k8s/logs/stream", async (req: Request, res: Response) => {
    const name = String(req.query.name ?? "");
    if (!name) return void res.status(400).json({ message: "Missing name" });
    const kind = kindOf(req);
    const context = String(req.query.context ?? "");
    const namespace = String(req.query.namespace ?? "");
    const opts = parseStreamOptions(req.query);
    const pick = { pods: csv(req.query.pods), container: typeof req.query.container === "string" && req.query.container ? req.query.container : undefined };

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (o: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };

    let closed = false;
    const procs = new Map<string, ChildProcessWithoutNullStreams>();
    const known = new Set<string>();
    let live = 0;
    let discovery: NodeJS.Timeout | undefined;
    const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(": ka\n\n"); }, KA_MS);

    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      if (discovery) clearInterval(discovery);
      for (const p of Array.from(procs.values())) p.kill("SIGTERM");
      procs.clear();
    };
    res.on("close", finish);

    const end = () => { if (!closed) { send({ t: "end" }); res.end(); finish(); } };

    const start = (pod: string, container: string, tailOverride?: number) => {
      const key = `${pod}/${container}`;
      if (procs.has(key)) return;
      const env = { ...process.env, ...getKubeconfigEnv() };
      const proc = spawn("kubectl", logArgs(pod, container, opts, { context, namespace }, tailOverride), { env });
      procs.set(key, proc);
      live++;
      const out = new LineSplitter();
      const err = new LineSplitter();
      proc.stdout.on("data", (b: Buffer) => { for (const l of out.push(b.toString("utf8"))) send({ t: "line", p: pod, c: container, l }); });
      proc.stderr.on("data", (b: Buffer) => { for (const m of err.push(b.toString("utf8"))) send({ t: "err", p: pod, c: container, m: m.slice(0, 300) }); });
      proc.on("error", (e) => send({ t: "err", p: pod, c: container, m: e.message }));
      proc.on("close", () => {
        for (const l of out.flush()) send({ t: "line", p: pod, c: container, l });
        live--;
        procs.delete(key);
        if (opts.follow) send({ t: "gone", p: pod, c: container });
        if (live === 0 && !discovery) end();
      });
    };

    const first = await resolveTargets(runKubectl, kind, name, context, namespace);
    if (!first.ok) { send({ t: "err", m: first.message, reason: first.reason }); return end(); }

    const plan = planStreams(first.pods, pick);
    for (const p of first.pods) known.add(p.name);
    send({ t: "meta", kind, name, selector: first.selector, pods: first.pods, streaming: plan.streams, skipped: plan.skippedPods, options: opts });
    if (plan.streams.length === 0) {
      send({ t: "err", m: first.pods.length === 0 ? `No pods found for ${kind}/${name}.` : "None of the selected pods has that container.", reason: "no-pods" });
      if (!(opts.follow && kind !== "pod")) return end();
    }
    for (const s of plan.streams) start(s.pod, s.container);

    // A rollout replaces pods while you watch: start streaming the new ones as they appear.
    if (opts.follow && kind !== "pod") {
      discovery = setInterval(async () => {
        const r = await resolveTargets(runKubectl, kind, name, context, namespace);
        if (closed || !r.ok) return;
        const fresh = r.pods.filter((p) => !known.has(p.name));
        if (fresh.length === 0) return;
        const next = planStreams(fresh, pick);
        for (const p of fresh) known.add(p.name);
        for (const s of next.streams) start(s.pod, s.container, NEW_POD_TAIL);
        send({ t: "pods", pods: r.pods, added: fresh.map((p) => p.name) });
      }, DISCOVERY_MS);
    }
  });
}
