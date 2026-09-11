"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const posService_1 = require("../services/posService");
const audit_1 = require("../lib/audit");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// Search sellable variants for the POS screen: by barcode, SKU, or product name.
router.get("/search", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q)
        return res.json({ results: [] });
    const like = `%${q}%`;
    const rows = client_1.sqliteConn
        .prepare(`SELECT v.id as variant_id, v.sku, v.barcode, v.color, v.size, v.fabric, v.selling_price,
              p.name as product_name, p.id as product_id, p.image_url as image_url, v.image_url as variant_image_url,
              COALESCE(p.gst_rate, c.gst_rate, 5) as gst_rate,
              COALESCE(p.hsn_code, c.hsn_code) as hsn_code,
              COALESCE((
                SELECT SUM(CASE
                  WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity
                  WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity
                  ELSE 0 END)
                FROM stock_ledger WHERE variant_id = v.id
              ), 0) as current_stock
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE v.active = 1 AND (v.barcode = ? OR v.sku LIKE ? OR p.name LIKE ?)
       ORDER BY p.name LIMIT 25`)
        .all(q, like, like);
    res.json({ results: rows });
});
const itemSchema = zod_1.z.object({
    variantId: zod_1.z.string(),
    quantity: zod_1.z.number().int().positive(),
    rate: zod_1.z.number().nonnegative().optional(),
    discountPct: zod_1.z.number().min(0).max(100).optional(),
    discountLayers: zod_1.z.array(zod_1.z.object({ type: zod_1.z.enum(["PERCENT", "FLAT"]), value: zod_1.z.number().nonnegative(), label: zod_1.z.string().optional() })).optional(),
});
const createInvoiceSchema = zod_1.z.object({
    customerId: zod_1.z.string().nullable().optional(),
    items: zod_1.z.array(itemSchema).min(1),
    paymentMode: zod_1.z.enum(["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"]),
    amountPaid: zod_1.z.number().nonnegative(),
    status: zod_1.z.enum(["DRAFT", "COMPLETED"]).default("COMPLETED"),
    notes: zod_1.z.string().optional(),
    payments: zod_1.z.array(zod_1.z.object({ mode: zod_1.z.string(), amount: zod_1.z.number(), reference: zod_1.z.string().optional() })).optional(),
    counterId: zod_1.z.string().nullable().optional(), membershipId: zod_1.z.string().nullable().optional(), couponId: zod_1.z.string().nullable().optional(), couponCode: zod_1.z.string().nullable().optional(),
    salesmanAllocations: zod_1.z.array(zod_1.z.object({ variantId: zod_1.z.string(), allocations: zod_1.z.array(zod_1.z.object({ userId: zod_1.z.string(), quantity: zod_1.z.number().int().positive() })) })).optional(),
});
router.post("/invoices", async (req, res) => {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid invoice payload", details: parsed.error.flatten() });
    }
    try {
        const invoice = (0, posService_1.createInvoice)({
            ...parsed.data,
            cashierId: req.user.userId,
        });
        await (0, audit_1.writeAudit)({
            userId: req.user.userId,
            action: parsed.data.status === "COMPLETED" ? "INVOICE_CREATE" : "INVOICE_HOLD",
            entity: "Invoice",
            entityId: invoice.id,
            details: { grandTotal: invoice.grand_total },
            ipAddress: req.ip,
        });
        res.status(201).json({ invoice });
    }
    catch (err) {
        if (err instanceof posService_1.InsufficientStockError) {
            return res.status(409).json({ error: err.message, code: "INSUFFICIENT_STOCK" });
        }
        console.error(err);
        res.status(400).json({ error: err.message || "Failed to create invoice" });
    }
});
router.get("/invoices/:id", (req, res) => {
    const invoice = (0, posService_1.getInvoiceById)(req.params.id);
    if (!invoice)
        return res.status(404).json({ error: "Invoice not found" });
    res.json({ invoice });
});
router.get("/invoices", (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = status
        ? client_1.sqliteConn.prepare(`SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(status, limit)
        : client_1.sqliteConn.prepare(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?`).all(limit);
    res.json({ invoices: rows });
});
router.get("/memberships", (_req, res) => res.json({ memberships: client_1.sqliteConn.prepare(`SELECT * FROM memberships WHERE active=1 ORDER BY name`).all() }));
router.get("/counters", (_req, res) => res.json({ counters: client_1.sqliteConn.prepare(`SELECT * FROM counters ORDER BY id`).all() }));
const finalizeSchema = zod_1.z.object({
    payments: zod_1.z.array(zod_1.z.object({ mode: zod_1.z.string(), amount: zod_1.z.number(), reference: zod_1.z.string().optional() })).min(1),
});
router.post("/invoices/:id/finalize", async (req, res) => {
    const parsed = finalizeSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "payments array required" });
    try {
        const invoice = (0, posService_1.finalizeDraftInvoice)(req.params.id, parsed.data.payments, req.user.userId);
        await (0, audit_1.writeAudit)({ userId: req.user.userId, action: "INVOICE_FINALIZE", entity: "Invoice", entityId: req.params.id, ipAddress: req.ip });
        res.json({ invoice });
    }
    catch (err) {
        if (err instanceof posService_1.InsufficientStockError) {
            return res.status(409).json({ error: err.message, code: "INSUFFICIENT_STOCK" });
        }
        res.status(400).json({ error: err.message || "Failed to finalize invoice" });
    }
});
router.post("/invoices/:id/cancel", async (req, res) => {
    const invoice = client_1.sqliteConn.prepare(`SELECT * FROM invoices WHERE id = ?`).get(req.params.id);
    if (!invoice)
        return res.status(404).json({ error: "Invoice not found" });
    if (invoice.status !== "DRAFT")
        return res.status(400).json({ error: "Only held (DRAFT) bills can be cancelled directly. Completed bills must go through Returns." });
    client_1.sqliteConn.prepare(`UPDATE invoices SET status = 'CANCELLED', updated_at = unixepoch() WHERE id = ?`).run(req.params.id);
    await (0, audit_1.writeAudit)({ userId: req.user.userId, action: "INVOICE_CANCEL", entity: "Invoice", entityId: req.params.id, ipAddress: req.ip });
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=pos.js.map