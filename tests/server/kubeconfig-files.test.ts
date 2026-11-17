import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { checkKubeconfig, clearCredentialsFiles, writeCredentialsFile } from "@server/kubeconfig-files";
import { unreachableKubeconfig } from "@tests/support/kubeconfig";

describe("decrypted kubeconfigs on disk", () => {
  it("sweep folders left by a process that is gone, keep only private files, and drop check copies at once", async () => {
    const leftover = path.join(os.tmpdir(), "kubedeck-clusters-99999999-test");
    mkdirSync(leftover, { recursive: true });
    writeFileSync(path.join(leftover, "prod.yaml"), "token: old");

    const file = writeCredentialsFile("clusters", "prod", "token: new");
    expect(existsSync(leftover)).toBe(false);
    expect(path.basename(path.dirname(file))).toMatch(new RegExp(`^kubedeck-clusters-${process.pid}-`));

    await checkKubeconfig("clusters", unreachableKubeconfig(), "x");
    expect(readdirSync(path.dirname(file))).toEqual(["prod.yaml"]);

    clearCredentialsFiles("clusters");
    expect(existsSync(file)).toBe(false);
  });
});
