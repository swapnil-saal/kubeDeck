import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { IN_CLUSTER_CONTEXT, inClusterKubeconfig } from "./incluster";

const opts = { host: "10.96.0.1", port: "443", caFile: "/sa/ca.crt", tokenFile: "/sa/token" };

describe("inClusterKubeconfig", () => {
  it("builds one context that reads the rotating token from its file", () => {
    const y = inClusterKubeconfig(opts);
    expect(y).toContain(`current-context: ${IN_CLUSTER_CONTEXT}`);
    expect(y).toContain('server: "https://10.96.0.1:443"');
    expect(y).toContain('tokenFile: "/sa/token"');
    expect(y).not.toMatch(/\btoken:\s/); // never a copied token that would expire
  });
  it("brackets IPv6 hosts", () => {
    expect(inClusterKubeconfig({ ...opts, host: "fd00::1" })).toContain('server: "https://[fd00::1]:443"');
  });
  it("is a kubeconfig that kubectl itself accepts", () => {
    const dir = mkdtempSync(join(tmpdir(), "kd-"));
    const file = join(dir, "config");
    writeFileSync(file, inClusterKubeconfig(opts));
    const out = execFileSync("kubectl", ["config", "get-contexts", "-o", "name", `--kubeconfig=${file}`], { encoding: "utf-8" });
    expect(out.trim()).toBe(IN_CLUSTER_CONTEXT);
  });
});
