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
  // KubeDeck groups and, per cluster, whom each acts as (server/groups)
  "0003_groups": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("kubedeck_group")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("description", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("position", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("updated_at", "text", (c) => c.notNull())
        .addColumn("updated_by", "text", (c) => c.notNull().defaultTo(""))
        .execute();
      await db.schema
        .createTable("group_cluster_access")
        .ifNotExists()
        .addColumn("group_id", "text", (c) => c.notNull())
        .addColumn("context", "text", (c) => c.notNull())
        .addColumn("acts_as", "text", (c) => c.notNull())
        .addColumn("namespace", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("service_account", "text", (c) => c.notNull().defaultTo(""))
        // an uploaded kubeconfig, encrypted; whom it signs in as; its API server
        .addColumn("credentials", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("identity", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("server", "text", (c) => c.notNull().defaultTo(""))
        .addPrimaryKeyConstraint("group_cluster_access_pk", ["group_id", "context"])
        .execute();
    },
    async down(db: Kysely<any>) {
      await sql`drop table if exists group_cluster_access`.execute(db);
      await sql`drop table if exists kubedeck_group`.execute(db);
    },
  },
  // projects (server/projects)
  "0004_projects": {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable("project")
        .ifNotExists()
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("name", "text", (c) => c.notNull())
        .addColumn("description", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("scopes", "text", (c) => c.notNull().defaultTo("[]"))
        .addColumn("created_at", "text", (c) => c.notNull())
        .addColumn("created_by", "text", (c) => c.notNull().defaultTo(""))
        .addColumn("updated_at", "text", (c) => c.notNull())
        .execute();
    },
    async down(db: Kysely<any>) {
      await sql`drop table if exists project`.execute(db);
    },
  },
});
