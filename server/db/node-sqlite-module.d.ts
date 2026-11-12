/**
 * The part of Node's built-in `node:sqlite` (Node 22.5+) KubeDeck uses. The installed @types/node
 * predates the module; drop this file once it includes `sqlite`.
 */
declare module "node:sqlite" {
  type SqlValue = null | number | bigint | string | Uint8Array;
  export class StatementSync {
    all(...params: SqlValue[]): unknown[];
    get(...params: SqlValue[]): unknown;
    run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    iterate(...params: SqlValue[]): IterableIterator<unknown>;
    columns(): { name: string }[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
