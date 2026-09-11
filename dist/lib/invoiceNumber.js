"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.currentFinancialYear = currentFinancialYear;
exports.nextInvoiceNumber = nextInvoiceNumber;
exports.nextPurchaseNumber = nextPurchaseNumber;
const client_1 = require("../db/client");
// Indian financial year: Apr 1 - Mar 31. e.g. Sep 2026 -> "2026-27"
function currentFinancialYear(d = new Date()) {
    const month = d.getMonth() + 1; // 1-12
    const year = d.getFullYear();
    if (month >= 4) {
        return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
    }
    return `${year - 1}-${String(year % 100).padStart(2, "0")}`;
}
const PREFIX = "SSS"; // Sarvani Suit and Saree
/**
 * Atomically increments and returns the next invoice number for a financial year.
 * Uses a single SQLite UPSERT statement (INSERT ... ON CONFLICT DO UPDATE ... RETURNING),
 * which SQLite executes as one atomic operation — safe even if two bills are
 * created back-to-back. The equivalent SQL works unchanged on Postgres in production.
 */
function nextInvoiceNumber(fy) {
    if (!client_1.sqliteConn) {
        throw new Error("nextInvoiceNumber: raw connection only available in SQLite dev mode");
    }
    const counterId = `INVOICE-${fy}`;
    const row = client_1.sqliteConn
        .prepare(`INSERT INTO counters (id, last_value) VALUES (?, 1)
       ON CONFLICT(id) DO UPDATE SET last_value = last_value + 1
       RETURNING last_value`)
        .get(counterId);
    const seq = String(row.last_value).padStart(6, "0");
    return `${PREFIX}/${fy}/${seq}`;
}
const SUPPLIER_PREFIX = "PUR";
function nextPurchaseNumber(fy) {
    if (!client_1.sqliteConn) {
        throw new Error("nextPurchaseNumber: raw connection only available in SQLite dev mode");
    }
    const counterId = `PURCHASE-${fy}`;
    const row = client_1.sqliteConn
        .prepare(`INSERT INTO counters (id, last_value) VALUES (?, 1)
       ON CONFLICT(id) DO UPDATE SET last_value = last_value + 1
       RETURNING last_value`)
        .get(counterId);
    const seq = String(row.last_value).padStart(6, "0");
    return `${SUPPLIER_PREFIX}/${fy}/${seq}`;
}
//# sourceMappingURL=invoiceNumber.js.map