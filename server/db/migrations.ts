/**
 * KubeDeck's own tables, in order. Never edit a migration that has shipped: add a new one.
 * Each module owns its tables; only that module reads or writes them.
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { DbType } from "./index";

export const MIGRATIONS = (type: DbType): Record<string, Migration> => ({
  "0001_audit_log": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("audit_log")
        .ifNotExists()
        .addColumn("id", type === "postgres" ? "bigserial" : "integer", (c) => (type === "postgres" ? c.primaryKey() : c.primaryKey().autoIncrement()))
        .addColumn("at", "text", (c) => c.notNull())
        .addColumn("user_email", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("user_name", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("groups", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("method", "text", (c) => c.notNull())
        .addColumn("path", "text", (c) => c.notNull())
        .addColumn("status", "integer", (c) => c.notNull())
        .addColumn("context", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("namespace", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("detail", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("ip", "text", (c) => c.notNull().defaultTo(""))
        .execute();
      await db.schema.createIndex("audit_log_at").ifNotExists().on("audit_log").column("at").execute();
      await db.schema.createIndex("audit_log_user").ifNotExists().on("audit_log").column("user_email").execute();
    },
    async down(db: Kysely<any>) {
      await sql`drop table if exists audit_log`.execute(db);
    },
  },
  "0002_plugin_state": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("plugin_state")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("kind", "text", (c) => c.notNull())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("enabled", "integer", (c) => c.notNull())
        .addColumn("values", "text", (c) => c.notNull().defaultTo("{}"))
        .addColumn("updated_at", "text", (c) => c.notNull())
        .addColumn("updated_by", "text", (c) => c.notNull().defaultTo(""))
        .execute();
    },
    async down(db: Kysely<any>) {
      await sql`drop table if exists plugin_state`.execute(db);
    },
  },
});
