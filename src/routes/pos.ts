import { Router } from "express";
import { z } from "zod";
import { sqliteConn } from "../db/client";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { createInvoice, getInvoiceById, finalizeDraftInvoice, InsufficientStockError } from "../services/posService";
import { writeAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

// Search sellable variants for the POS screen: by barcode, SKU, or product name.
router.get("/search", (req: AuthedRequest, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ results: [] });

  const like = `%${q}%`;
  const rows = sqliteConn!
    .prepare(
      `SELECT v.id as variant_id, v.sku, v.barcode, v.color, v.size, v.fabric, v.selling_price,
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
       ORDER BY p.name LIMIT 25`
    )
    .all(q, like, like);

  res.json({ results: rows });
});

const itemSchema = z.object({
  variantId: z.string(),
  quantity: z.number().int().positive(),
  rate: z.number().nonnegative().optional(),
  discountPct: z.number().min(0).max(100).optional(),
  discountLayers: z.array(z.object({type:z.enum(["PERCENT","FLAT"]),value:z.number().nonnegative(),label:z.string().optional()})).optional(),
});

const createInvoiceSchema = z.object({
  customerId: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
  paymentMode: z.enum(["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"]),
  amountPaid: z.number().nonnegative(),
  status: z.enum(["DRAFT", "COMPLETED"]).default("COMPLETED"),
  notes: z.string().optional(),
  payments: z.array(z.object({ mode: z.string(), amount: z.number(), reference: z.string().optional() })).optional(),
  counterId: z.string().nullable().optional(), membershipId: z.string().nullable().optional(), couponId: z.string().nullable().optional(), couponCode: z.string().nullable().optional(),
  salesmanAllocations: z.array(z.object({variantId:z.string(),allocations:z.array(z.object({userId:z.string(),quantity:z.number().int().positive()}))})).optional(),
});

router.post("/invoices", async (req: AuthedRequest, res) => {
  const parsed = createInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid invoice payload", details: parsed.error.flatten() });
  }
  try {
    const invoice = createInvoice({
      ...parsed.data,
      cashierId: req.user!.userId,
    });
    await writeAudit({
      userId: req.user!.userId,
      action: parsed.data.status === "COMPLETED" ? "INVOICE_CREATE" : "INVOICE_HOLD",
      entity: "Invoice",
      entityId: (invoice as any).id,
      details: { grandTotal: (invoice as any).grand_total },
      ipAddress: req.ip,
    });
    res.status(201).json({ invoice });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) {
      return res.status(409).json({ error: err.message, code: "INSUFFICIENT_STOCK" });
    }
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to create invoice" });
  }
});

router.get("/invoices/:id", (req: AuthedRequest, res) => {
  const invoice = getInvoiceById(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json({ invoice });
});

router.get("/invoices", (req: AuthedRequest, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = status
    ? sqliteConn!.prepare(`SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(status, limit)
    : sqliteConn!.prepare(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?`).all(limit);
  res.json({ invoices: rows });
});

router.get("/memberships", (_req,res)=>res.json({memberships:sqliteConn!.prepare(`SELECT * FROM memberships WHERE active=1 ORDER BY name`).all()}));
router.get("/counters", (_req,res)=>res.json({counters:sqliteConn!.prepare(`SELECT * FROM counters ORDER BY id`).all()}));

const finalizeSchema = z.object({
  payments: z.array(z.object({ mode: z.string(), amount: z.number(), reference: z.string().optional() })).min(1),
});

router.post("/invoices/:id/finalize", async (req: AuthedRequest, res) => {
  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payments array required" });
  try {
    const invoice = finalizeDraftInvoice(req.params.id, parsed.data.payments as any, req.user!.userId);
    await writeAudit({ userId: req.user!.userId, action: "INVOICE_FINALIZE", entity: "Invoice", entityId: req.params.id, ipAddress: req.ip });
    res.json({ invoice });
  } catch (err: any) {
    if (err instanceof InsufficientStockError) {
      return res.status(409).json({ error: err.message, code: "INSUFFICIENT_STOCK" });
    }
    res.status(400).json({ error: err.message || "Failed to finalize invoice" });
  }
});

router.post("/invoices/:id/cancel", async (req: AuthedRequest, res) => {
  const invoice = sqliteConn!.prepare(`SELECT * FROM invoices WHERE id = ?`).get(req.params.id) as any;
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status !== "DRAFT") return res.status(400).json({ error: "Only held (DRAFT) bills can be cancelled directly. Completed bills must go through Returns." });
  sqliteConn!.prepare(`UPDATE invoices SET status = 'CANCELLED', updated_at = unixepoch() WHERE id = ?`).run(req.params.id);
  await writeAudit({ userId: req.user!.userId, action: "INVOICE_CANCEL", entity: "Invoice", entityId: req.params.id, ipAddress: req.ip });
  res.json({ ok: true });
});

export default router;
