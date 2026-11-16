/**
 * KubeDeck's database: one Kysely connection that the login (Better Auth) and KubeDeck's own tables
 * share. SQLite for a single instance and local use (Node's built-in `node:sqlite`, no native add-on),
 * Postgres when several KubeDeck replicas run.
 *
 *   KUBEDECK_DATABASE_URL=postgres://user:pass@host:5432/kubedeck
 *   KUBEDECK_DATABASE_URL=sqlite:/var/lib/kubedeck/kubedeck.db      (default: ~/.kubedeck/kubedeck.db)
 *
 * The desktop app opens the default file for its audit log only (no accounts: Better Auth is web-only).
 */
import { mkdirSync } from "fs";
import os from "os";
import path from "path";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import { MIGRATIONS } from "./migrations";
import { nodeSqliteDatabase } from "./node-sqlite";

export type DbType = "sqlite" | "postgres";

export interface Database {
  db: Kysely<any>;
  type: DbType;
  /** where it is, for logs (never includes a password) */
  where: string;
  close(): Promise<void>;
}

export interface DbTarget {
  type: DbType;
  /** sqlite: a file path (or ":memory:"); postgres: the connection string */
  target: string;
}

const DEFAULT_SQLITE = () => path.join(os.homedir(), ".kubedeck", "kubedeck.db");

/** Where the database is, from KUBEDECK_DATABASE_URL. */
export function databaseTarget(raw = process.env.KUBEDECK_DATABASE_URL ?? ""): DbTarget {
  const url = raw.trim();
  if (!url) return { type: "sqlite", target: DEFAULT_SQLITE() };
  if (/^postgres(ql)?:\/\//i.test(url)) return { type: "postgres", target: url };
  if (/^sqlite:/i.test(url)) return { type: "sqlite", target: url.replace(/^sqlite:(\/\/)?/i, "") || DEFAULT_SQLITE() };
  throw new Error(`KUBEDECK_DATABASE_URL must start with postgres:// or sqlite: (got "${url.split(":")[0]}:…").`);
}

/** The connection string without its password, for logs. */
export function redact(t: DbTarget): string {
  if (t.type === "sqlite") return `sqlite ${t.target}`;
  try {
    const u = new URL(t.target);
    if (u.password) u.password = "***";
    return `postgres ${u.host}${u.pathname}`;
  } catch {
    return "postgres";
  }
}

export async function openDatabase(t: DbTarget = databaseTarget()): Promise<Database> {
  if (t.type === "postgres") {
    // loaded only when Postgres is used
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: t.target, max: 10 });
    const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    return { db, type: "postgres", where: redact(t), close: () => db.destroy() };
  }
  if (t.target !== ":memory:") {
    const dir = path.dirname(t.target);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      // a read-only root filesystem reports ENOENT or EROFS here, which reads as a missing file
      const code = (err as NodeJS.ErrnoException).code ?? "";
      throw new Error(
        `cannot create ${dir} for the SQLite database (${code || (err as Error).message}). ` +
          "Point KUBEDECK_DATABASE_URL at a writable volume, e.g. sqlite:/data/kubedeck.db, or at Postgres (postgres://…).",
      );
    }
  }
  const db = new Kysely<any>({ dialect: new SqliteDialect({ database: await nodeSqliteDatabase(t.target) }) });
  return { db, type: "sqlite", where: redact(t), close: () => db.destroy() };
}

/**
 * Open and migrate the database on start. When it is not `required` (the desktop, which only keeps
 * its audit log there) a failure is one warning and null, never a failed start.
 */
export async function openAppDatabase(o: { required: boolean; target?: DbTarget }): Promise<Database | null> {
  let d: Database | null = null;
  try {
    d = await openDatabase(o.target ?? databaseTarget());
    await migrate(d);
    console.log(`[kubedeck] database: ${d.where}`);
    return d;
  } catch (err) {
    if (o.required) throw err;
    await d?.close().catch(() => undefined);
    console.warn(`[kubedeck] no audit log: could not open the database (${err instanceof Error ? err.message : err})`);
    return null;
  }
}

/** KubeDeck's own tables (Better Auth migrates its tables itself). Safe to run on every start. */
export async function migrate(d: Database): Promise<void> {
  const migrator = new Migrator({
    db: d.db,
    migrationTableName: "kubedeck_migration",
    migrationLockTableName: "kubedeck_migration_lock",
    provider: { getMigrations: async () => MIGRATIONS(d.type) as Record<string, Migration> },
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) if (r.status === "Error") console.error(`[kubedeck] migration ${r.migrationName} failed`);
  if (error) throw error instanceof Error ? error : new Error(String(error));
}
