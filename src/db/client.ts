// ============================================================
// DB client wiring.
//
// DEV (right now, in this sandbox / your laptop): SQLite file,
//   zero external services needed, real ACID transactions.
//
// PRODUCTION: set DB_DRIVER=postgres and DATABASE_URL to your
//   Postgres connection string. That's the ONLY change needed —
//   all route/business logic code is driver-agnostic because it
//   only ever imports `db` and the transaction wrapper below.
// ============================================================
import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DB_DRIVER = process.env.DB_DRIVER || "sqlite";

let db: ReturnType<typeof drizzleSqlite>;
let sqliteConn: Database.Database | null = null;

if (DB_DRIVER === "postgres") {
  // Lazy-require so the sqlite path (used in this build/dev env)
  // never needs the `pg` driver to be configured.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drizzle: drizzlePg } = require("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzlePg(pool, { schema }) as unknown as ReturnType<typeof drizzleSqlite>;
} else {
  const dbPath = process.env.SQLITE_PATH || "./dev.db";
  sqliteConn = new Database(dbPath);
  sqliteConn.pragma("journal_mode = WAL"); // safe for concurrent reads while writing
  sqliteConn.pragma("foreign_keys = ON");
  db = drizzleSqlite(sqliteConn, { schema });
}

export { db, schema, sqliteConn, DB_DRIVER };
