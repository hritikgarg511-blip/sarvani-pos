"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DB_DRIVER = exports.sqliteConn = exports.schema = exports.db = void 0;
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
require("dotenv/config");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const better_sqlite3_2 = require("drizzle-orm/better-sqlite3");
const schema = __importStar(require("./schema"));
exports.schema = schema;
const DB_DRIVER = process.env.DB_DRIVER || "sqlite";
exports.DB_DRIVER = DB_DRIVER;
let db;
let sqliteConn = null;
exports.sqliteConn = sqliteConn;
if (DB_DRIVER === "postgres") {
    // Lazy-require so the sqlite path (used in this build/dev env)
    // never needs the `pg` driver to be configured.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require("pg");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { drizzle: drizzlePg } = require("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    exports.db = db = drizzlePg(pool, { schema });
}
else {
    const dbPath = process.env.SQLITE_PATH || "./dev.db";
    exports.sqliteConn = sqliteConn = new better_sqlite3_1.default(dbPath);
    sqliteConn.pragma("journal_mode = WAL"); // safe for concurrent reads while writing
    sqliteConn.pragma("foreign_keys = ON");
    exports.db = db = (0, better_sqlite3_2.drizzle)(sqliteConn, { schema });
}
//# sourceMappingURL=client.js.map