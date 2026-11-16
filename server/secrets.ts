/**
 * Secrets KubeDeck stores (plugin tokens, groups' uploaded kubeconfigs) are encrypted first: AES-256-GCM
 * with a key from KUBEDECK_AUTH_SECRET in web mode (the same on every replica), or from a key file
 * KubeDeck creates in ~/.kubedeck on the desktop. Each use has its own key (`purpose`).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const PREFIX = "enc:v1:";

/** The 32-byte key: from the web sign-in secret, else a local key file (created once, readable only by you). */
export function secretKey(env: NodeJS.ProcessEnv = process.env, dir = path.join(os.homedir(), ".kubedeck"), purpose = "plugins"): Buffer {
  if (env.KUBEDECK_AUTH_SECRET) return createHash("sha256").update(`kubedeck-${purpose}:${env.KUBEDECK_AUTH_SECRET}`).digest();
  const file = path.join(dir, "plugins.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  const raw = Buffer.from(fs.readFileSync(file, "utf-8").trim(), "base64");
  // the plugins' key is the file's own, as it always was
  return purpose === "plugins" ? raw : createHash("sha256").update(`kubedeck-${purpose}:`).update(raw).digest();
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain, "utf-8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** Undo encrypt(). A value that was never encrypted comes back as it is. */
export function decrypt(stored: string, key: Buffer): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf-8");
}
