import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "date-fns",
  "express",
  "nanoid",
  "ws",
  "zod",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  // Desktop: dependencies stay external (the app ships node_modules).
  // KUBEDECK_BUNDLE_ALL=1 (the Docker image): bundle every runtime dependency into dist/index.cjs so the
  // container needs no node_modules. Dev tooling and optional native add-ons stay external; they are never
  // loaded in production (the Vite dev server import is dead code there, ws falls back without bufferutil).
  const bundleAll = process.env.KUBEDECK_BUNDLE_ALL === "1";
  const externals = bundleAll
    ? [...Object.keys(pkg.devDependencies || {}), "bufferutil", "utf-8-validate", "electron"]
    : allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
