import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@server": path.resolve(import.meta.dirname, "server"),
      "@tests": path.resolve(import.meta.dirname, "tests"),
    },
  },
  test: {
    environment: "node",
    // every test lives under tests/, mirroring the code: tests/server, tests/client (= client/src), tests/shared
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
