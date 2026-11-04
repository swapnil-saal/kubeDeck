/**
 * Browse and search a container's files (desktop only: registered when not in web mode).
 * All read-only; see pod-files.ts for how commands are built.
 */
import { spawn } from "child_process";
import type { Express, Request, Response } from "express";
import { getKubeconfigEnv } from "./settings";
import { runKubectlRaw } from "./kubectl-run";
import {
  cleanPath, cleanQuery, downloadName, execArgs, explainExecError, parseGrep, parseListing, parseRead, runInPod, searchable,
  DOWNLOAD_TIMEOUT_MS, MAX_DOWNLOAD_BYTES, MAX_FILE_BYTES, MAX_RESULTS, type ExecTarget,
} from "./pod-files";

function target(req: Request): ExecTarget {
  const q = req.query as Record<string, string | undefined>;
  return {
    pod: String(req.params.name),
    namespace: q.namespace && q.namespace !== "all" ? q.namespace : "default",
    context: q.context ?? "",
    container: q.container || undefined,
  };
}

function fail(res: Response, stderr: string) {
  const { status, message } = explainExecError(stderr);
  res.status(status).json({ message });
}

export function registerPodFilesRoutes(app: Express): void {
  /** Containers of the pod, with their working directory (where browsing starts). */
  app.get("/api/k8s/pods/:name/files/containers", async (req, res) => {
    const t = target(req);
    const ctx = t.context ? `--context=${t.context}` : "";
    const r = await runKubectlRaw(
      `get pod ${t.pod} -n ${t.namespace} ${ctx} -o jsonpath={range.spec.containers[*]}{.name}{"\\t"}{.workingDir}{"\\n"}{end}`,
    );
    if (r.code !== 0) return fail(res, r.stderr);
    const containers = r.stdout.split("\n").filter(Boolean).map((l) => {
      const [name, workingDir] = l.split("\t");
      return { name, workingDir: workingDir || null };
    });
    res.json(containers);
  });

  /** Folder listing. Without `path`, the container's working directory. */
  app.get("/api/k8s/pods/:name/files/list", async (req, res) => {
    const t = target(req);
    let path = req.query.path === undefined ? null : cleanPath(req.query.path);
    if (req.query.path !== undefined && !path) return res.status(400).json({ message: "Invalid path." });
    if (!path) {
      const wd = await runInPod(t, "workdir", []);
      if (wd.code !== 0) return fail(res, wd.stderr);
      path = cleanPath(wd.stdout.toString("utf-8").trim()) ?? "/";
    }
    const r = await runInPod(t, "list", [path]);
    if (r.code !== 0) return fail(res, r.stderr);
    res.json({ path, ...parseListing(r.stdout.toString("utf-8")) });
  });

  /** One file's text (at most 512 KB). */
  app.get("/api/k8s/pods/:name/files/read", async (req, res) => {
    const path = cleanPath(req.query.path);
    if (!path) return res.status(400).json({ message: "Invalid path." });
    const r = await runInPod(target(req), "read", [path, String(MAX_FILE_BYTES)]);
    if (r.code !== 0) return fail(res, r.stderr);
    res.json({ path, ...parseRead(r.stdout) });
  });

  /** Search file names (`mode=name`) or contents (`mode=content`, fixed string) under a folder. */
  app.get("/api/k8s/pods/:name/files/search", async (req, res) => {
    const path = cleanPath(req.query.path);
    const q = cleanQuery(req.query.q);
    const mode = req.query.mode === "name" ? "name" : "content";
    // node_modules, .git, vendor… are skipped unless asked for
    const everything = req.query.all === "1";
    if (!path || !q) return res.status(400).json({ message: "A folder and 1–200 characters of search text are needed." });
    if (!searchable(path)) return res.status(400).json({ message: "Pick a folder to search in: / and /proc, /sys, /dev are too large or endless." });
    const r = await runInPod(target(req), everything ? (mode === "name" ? "nameAll" : "contentAll") : mode, [path, q]);
    // grep exits 1 for "no matches": that is a result, not an error
    if (r.code !== 0 && r.code !== 1 && r.stdout.length === 0) return fail(res, r.stderr);
    const text = r.stdout.toString("utf-8");
    if (mode === "name") {
      const paths = text.split("\n").filter(Boolean);
      return res.json({ mode, path, q, results: paths.map((p) => ({ path: p })), capped: paths.length >= MAX_RESULTS });
    }
    const matches = parseGrep(text);
    res.json({ mode, path, q, results: matches, capped: matches.length >= MAX_RESULTS });
  });

  /**
   * Download a file as-is, or a folder as `<name>.tar.gz`. Streamed straight from kubectl exec:
   * headers are sent with the first byte, so a failure before that still gets a readable error.
   */
  app.get("/api/k8s/pods/:name/files/download", (req, res) => {
    const path = cleanPath(req.query.path);
    // `archive=1`: the folder as .tar.gz (not `kind`, which the log routes validate)
    const folder = req.query.archive === "1";
    if (!path || (folder && path === "/")) return res.status(400).json({ message: folder ? "Pick a folder below /." : "Invalid path." });

    const proc = spawn("kubectl", execArgs(target(req), folder ? "archive" : "download", [path]), {
      env: { ...process.env, ...getKubeconfigEnv() },
    });
    let sent = 0;
    let stderr = "";
    const stop = () => proc.kill("SIGKILL");
    const timer = setTimeout(stop, DOWNLOAD_TIMEOUT_MS);
    res.on("close", () => { if (!res.writableEnded) stop(); });

    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
    proc.stdout.on("data", (c: Buffer) => {
      if (sent === 0) {
        res.setHeader("Content-Type", folder ? "application/gzip" : "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName(path, folder)}"`);
        res.setHeader("Cache-Control", "no-store");
      }
      sent += c.length;
      if (sent > MAX_DOWNLOAD_BYTES) {
        stop();
        res.destroy();
        return;
      }
      if (!res.write(c)) {
        proc.stdout.pause();
        res.once("drain", () => proc.stdout.resume());
      }
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (sent === 0) {
        // nothing streamed: either an error, or an empty file
        if (code !== 0) return fail(res, stderr);
        res.setHeader("Content-Disposition", `attachment; filename="${downloadName(path, folder)}"`);
        return res.status(200).end();
      }
      // a failure mid-stream cannot change the status any more: cut the response so it is not mistaken for complete
      if (code !== 0) res.destroy();
      else res.end();
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      if (!res.headersSent) res.status(500).json({ message: e.message });
      else res.destroy();
    });
  });
}
