import Database from "better-sqlite3";
import path from "node:path";

// A committed point-in-time snapshot, not a live connection to the original
// football-data-collector database — Vercel's serverless functions can't
// reach a file on the local machine. Refresh it with `npm run sync:shared-db`
// (copies from the original local path) whenever the source data updates,
// then commit and redeploy.
const SHARED_DB_PATH = path.join(process.cwd(), "data", "shared_data.db");

let db: Database.Database | null = null;

// Server-only: better-sqlite3 is a native, synchronous module and must never
// be imported from client components. Connection is opened once and reused.
function getSharedDb(): Database.Database {
  if (!db) {
    db = new Database(SHARED_DB_PATH, { readonly: true, fileMustExist: true });
  }
  return db;
}

export interface TableInfo {
  name: string;
  columns: { name: string; type: string }[];
  rowCount: number;
}

export function listTables(): TableInfo[] {
  const database = getSharedDb();
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string }[];

  return tables.map(({ name }) => {
    const columns = (database.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as {
      name: string;
      type: string;
    }[]).map((col) => ({ name: col.name, type: col.type }));

    const { count } = database
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(name)}`)
      .get() as { count: number };

    return { name, columns, rowCount: count };
  });
}

export function getSampleRows(tableName: string, limit = 5): Record<string, unknown>[] {
  const database = getSharedDb();
  return database
    .prepare(`SELECT * FROM ${quoteIdent(tableName)} LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
}

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const database = getSharedDb();
  return database.prepare(sql).all(...params) as T[];
}

// Guards against identifiers containing the quote character; SQLite table/column
// names are read from sqlite_master here, never from user input.
function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
