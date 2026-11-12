/**
 * Node's built-in SQLite (`node:sqlite`, Node 22.5+) shaped as the database Kysely's SqliteDialect
 * expects, so KubeDeck needs no native add-on (the Docker image is built for two CPU architectures).
 */
import type { SqliteDatabase, SqliteStatement } from "kysely";

type Param = null | number | bigint | string | Uint8Array;

/** node:sqlite binds only these; booleans and dates arrive already converted by the auth adapter, but be safe. */
function bindable(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string" || v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

export async function nodeSqliteDatabase(file: string): Promise<SqliteDatabase> {
  // a dynamic import keeps the module (and its "experimental" warning) out of the desktop app
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return {
    close: () => db.close(),
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql);
      const args = (p: ReadonlyArray<unknown>) => p.map(bindable);
      return {
        reader: stmt.columns().length > 0,
        all: (p) => stmt.all(...args(p)),
        run: (p) => {
          const r = stmt.run(...args(p));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        iterate: (p) => stmt.iterate(...args(p)) as IterableIterator<unknown>,
      };
    },
  };
}
