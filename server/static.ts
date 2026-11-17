import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

/**
 * The documentation site (built by `npm run docs:build` from documentation/ into dist/docs) at /docs.
 * Public, like the app's own files: it holds no data. Registered before the app's catch-all routes.
 */
/** The built documentation site, or undefined when it was not built. */
export function docsDir(): string | undefined {
  // next to the bundle in production (dist/index.cjs); dist/docs in a checkout (dev runs as ESM, without __dirname)
  const beside = typeof __dirname === "string" ? [path.resolve(__dirname, "docs")] : [];
  return [...beside, path.resolve(process.cwd(), "dist", "docs")].find((d) => fs.existsSync(path.join(d, "index.html")));
}

export function serveDocs(app: Express) {
  const dir = docsDir();
  if (!dir) {
    app.use("/docs", (_req, res) => { res.status(404).type("text/plain").send("The documentation is not built here. Run: npm run docs:build"); });
    return;
  }
  app.use("/docs", express.static(dir));
  app.use("/docs", (_req, res) => { res.status(404).sendFile(path.join(dir, "404.html")); });
}
