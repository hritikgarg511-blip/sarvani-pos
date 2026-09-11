"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("./db/client");
const id_1 = require("./lib/id");
if (!client_1.sqliteConn)
    throw new Error("BUSY import requires SQLite");
const db = client_1.sqliteConn;
const dataPath = path_1.default.resolve(process.env.BUSY_JSON_PATH || path_1.default.join(__dirname, "..", "..", "data", "busy", "busy-export.json"));
if (!fs_1.default.existsSync(dataPath))
    throw new Error(`BUSY export JSON not found: ${dataPath}`);
const data = JSON.parse(fs_1.default.readFileSync(dataPath, "utf8"));
const source = "BUSY-FY-2026-01-04-to-2026-09-06";
if (db.prepare(`SELECT id FROM import_runs WHERE source=?`).get(source)) {
    console.log("BUSY data already imported; skipping duplicate import.");
    process.exit(0);
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function ts(s) { const [d, m, y] = (s || "").split("-").map(Number); return d && m && y ? Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000) : Math.floor(Date.now() / 1000); }
function gstRate(cat) { const m = String(cat || "").match(/(\d+(?:\.\d+)?)\s*%/); return m ? Number(m[1]) : 0; }
function paymentMode(account) { const x = String(account || "").toUpperCase(); if (x.includes("PAYTM") || x.includes("UPI") || x.includes("PHONEPE") || x.includes("GPAY"))
    return "UPI"; if (x.includes("CARD") || x.includes("BOB CARDS") || x.includes("CREDIT CARD"))
    return "CARD"; if (x.includes("BANK"))
    return "BANK_TRANSFER"; return "CASH"; }
function stock(variantId) { return Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity ELSE 0 END),0) s FROM stock_ledger WHERE variant_id=?`).get(variantId).s || 0); }
function addStock(variantId, type, qty, refType, refId, created, note) { const cur = stock(variantId); const inbound = ["PURCHASE_IN", "SALE_RETURN_IN", "ADJUSTMENT_IN", "OPENING_STOCK"].includes(type); const after = cur + (inbound ? qty : -qty); db.prepare(`INSERT INTO stock_ledger(id,variant_id,type,quantity,balance_after,ref_type,ref_id,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run((0, id_1.newId)(), variantId, type, Math.abs(qty), after, refType, refId, note, created); return after; }
const tx = db.transaction(() => {
    const counts = { accounts: 0, items: 0, purchases: 0, sales: 0 };
    // Preserve BUSY chart/accounts for accounting-support reports.
    for (const a of data.accounts || []) {
        db.prepare(`INSERT OR IGNORE INTO legacy_accounts(id,name,parent,op_balance,state_name,gstin,dealer_type,source_code) VALUES(?,?,?,?,?,?,?,?)`).run((0, id_1.newId)(), a.name, a.parent || null, num(a.opBal), a.stateName || null, a.gstin || null, a.dealer || null, a.name);
        counts.accounts++;
    }
    const categoryIds = new Map();
    const getCategory = (name) => { const n = (name || "General").trim() || "General"; if (categoryIds.has(n))
        return categoryIds.get(n); const ex = db.prepare(`SELECT id FROM categories WHERE name=?`).get(n); if (ex) {
        categoryIds.set(n, ex.id);
        return ex.id;
    } const id = (0, id_1.newId)(); db.prepare(`INSERT INTO categories(id,name,hsn_code,gst_rate,created_at) VALUES(?,?,?,?,?)`).run(id, n, null, 5, Math.floor(Date.now() / 1000)); categoryIds.set(n, id); return id; };
    const variants = new Map();
    // First pass: create all 1,886 BUSY item masters as POS products/variants.
    for (const it of data.items || []) {
        const categoryId = getCategory(it.parent);
        const existing = db.prepare(`SELECT v.id FROM product_variants v JOIN products p ON p.id=v.product_id WHERE p.name=?`).get(it.name);
        let vid = existing?.id;
        if (!vid) {
            const pid = (0, id_1.newId)();
            vid = (0, id_1.newId)();
            const opening = num(it.openingStock);
            const unitCost = opening > 0 ? num(it.openingAmount) / opening : 0;
            const sku = `BUSY-${it.tmpCode || it.name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}`;
            db.prepare(`INSERT INTO products(id,name,category_id,hsn_code,gst_rate,brand,description,active,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,1,unixepoch(),unixepoch())`).run(pid, it.name, categoryId, it.hsn || null, 5, `Imported from BUSY • Unit: ${it.unit || 'Pcs.'}`);
            db.prepare(`INSERT INTO product_variants(id,product_id,sku,purchase_rate,selling_price,min_stock_level,active,created_at,updated_at) VALUES(?,?,?,?,?,2,1,unixepoch(),unixepoch())`).run(vid, pid, sku, unitCost, unitCost);
            if (opening > 0)
                addStock(vid, "OPENING_STOCK", Math.round(opening), "BUSY_OPENING", it.tmpCode || pid, Math.floor(new Date("2026-04-01").getTime() / 1000), "BUSY opening stock");
        }
        variants.set(it.name, vid);
        counts.items++;
    }
    // Purchases before sales so stock ledger chronology follows business events.
    for (const p of data.purchases || []) {
        let supplier = db.prepare(`SELECT id FROM suppliers WHERE name=?`).get(p.party);
        if (!supplier) {
            const sid = (0, id_1.newId)();
            db.prepare(`INSERT INTO suppliers(id,name,gstin,state_code,active,created_at) VALUES(?,?,?,?,1,?)`).run(sid, p.party, p.gstin || null, p.state === 'Rajasthan' ? '08' : null, ts(p.date));
            supplier = { id: sid };
        }
        const pid = (0, id_1.newId)(), pnum = `BUSY-P-${p.date.replace(/-/g, '')}-${p.vchNo}`;
        const exists = db.prepare(`SELECT id FROM purchases WHERE purchase_number=?`).get(pnum);
        if (exists)
            continue;
        let sub = 0, tax = 0;
        for (const it of p.items || []) {
            sub += num(it.amt);
            tax += Math.max(0, num(it.nett) - num(it.amt));
        }
        const grand = Number((sub + tax).toFixed(2));
        db.prepare(`INSERT INTO purchases(id,purchase_number,supplier_id,invoice_ref_no,status,sub_total,tax_total,grand_total,paid_amount,balance_due,created_by_id,created_at,notes) VALUES(?,?,?,?,?,?,?,?,?,?,(SELECT id FROM users WHERE phone='7976900021' LIMIT 1),?,?)`).run(pid, pnum, supplier.id, p.billNo || null, "RECEIVED", sub, tax, grand, 0, grand, ts(p.date), "Imported from BUSY");
        for (const it of p.items || []) {
            const vid = variants.get(it.name);
            if (!vid)
                continue;
            const qty = Math.round(num(it.qty));
            const rate = num(it.price);
            const taxAmt = Math.max(0, num(it.nett) - num(it.amt));
            db.prepare(`INSERT INTO purchase_items(id,purchase_id,variant_id,quantity,rate,gst_rate,taxable_value,tax_amount,line_total) VALUES(?,?,?,?,?,?,?,?,?)`).run((0, id_1.newId)(), pid, vid, qty, rate, gstRate(it.taxcat), num(it.amt), taxAmt, num(it.nett));
            addStock(vid, "PURCHASE_IN", qty, "BUSY_PURCHASE", pid, ts(p.date), "Imported BUSY purchase");
        }
        ;
        counts.purchases++;
    }
    // Sales history and payment history.
    for (const sale of data.sales || []) {
        const date = ts(sale.date), party = String(sale.party || "Cash");
        let customerId = null;
        if (party.toLowerCase() !== "cash") {
            let c = db.prepare(`SELECT id FROM customers WHERE name=?`).get(party);
            if (!c) {
                const cid = (0, id_1.newId)();
                db.prepare(`INSERT INTO customers(id,name,phone,state,state_code,gstin,whatsapp_opt_in,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)`).run(cid, party, "0000000000", sale.state || null, sale.state === 'Rajasthan' ? '08' : null, sale.gstin || null, date, date);
                c = { id: cid };
            }
            customerId = c.id;
        }
        const invoiceId = (0, id_1.newId)(), invNo = `BUSY-S-${sale.date.replace(/-/g, '')}-${sale.series || 'Main'}-${sale.vchNo}`;
        if (db.prepare(`SELECT id FROM invoices WHERE invoice_number=?`).get(invNo))
            continue;
        let sub = 0;
        for (const it of sale.items || [])
            sub += num(it.amt);
        const pm = sale.payments?.[0] ? paymentMode(sale.payments[0].account) : "CASH";
        const paid = Math.abs(num(sale.payments?.reduce((a, x) => a + num(x.amount), 0)));
        db.prepare(`INSERT INTO invoices(id,invoice_number,financial_year,customer_id,cashier_id,sub_total,discount_total,taxable_total,cgst_total,sgst_total,igst_total,round_off,grand_total,place_of_supply_state_code,is_inter_state,payment_mode,amount_paid,balance_due,status,notes,created_at,updated_at) VALUES(?,?,?,?,(SELECT id FROM users WHERE phone='7976900021' LIMIT 1),?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'COMPLETED',?, ?,?)`).run(invoiceId, invNo, "2026-27", customerId, sub, 0, sub, 0, 0, 0, 0, sub, sale.state === 'Rajasthan' ? '08' : null, 0, pm, paid, Math.max(0, sub - paid), "Imported from BUSY", date, date);
        for (const it of sale.items || []) {
            const vid = variants.get(it.name);
            if (!vid)
                continue;
            const qty = Math.round(num(it.qty)), rate = num(it.price), gr = num(it.taxcat.match?.(/(\d+(?:\.\d+)?)%/)?.[1] || 0);
            db.prepare(`INSERT INTO invoice_items(id,invoice_id,variant_id,description,hsn_code,quantity,rate,discount_pct,discount_amt,taxable_value,gst_rate,cgst_amt,sgst_amt,igst_amt,line_total,returned_qty,discount_layers_json) VALUES(?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,0,'[]')`).run((0, id_1.newId)(), invoiceId, vid, it.name, it.hsn || null, qty, rate, rate * qty, gr, 0, 0, 0, num(it.amt));
            addStock(vid, "SALE_OUT", qty, "BUSY_SALE", invoiceId, date, "Imported BUSY sale");
        }
        if (paid > 0)
            db.prepare(`INSERT INTO payments(id,invoice_id,mode,amount,created_at) VALUES(?,?,?,?,?)`).run((0, id_1.newId)(), invoiceId, pm, paid, date);
        counts.sales++;
    }
    db.prepare(`INSERT INTO import_runs(id,source,record_counts) VALUES(?,?,?)`).run((0, id_1.newId)(), source, JSON.stringify(counts));
    return counts;
})();
console.log("BUSY import complete:", tx);
//# sourceMappingURL=importBusy.js.map