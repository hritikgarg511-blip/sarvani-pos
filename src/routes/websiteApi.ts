import { Router, Request, Response } from "express";
import { z } from "zod";
import { sqliteConn } from "../db/client";
import { newId } from "../lib/id";
import { createInvoice, getInvoiceById } from "../services/posService";

const router = Router();
const token = () => String(process.env.WEBSITE_API_TOKEN || process.env.WEBSITE_INTEGRATION_TOKEN || "").trim();

function authorized(req: Request) {
  const expected = token();
  if (!expected) return false;
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return bearer === expected || String(req.headers["x-website-api-token"] || "") === expected;
}

function gate(req: Request, res: Response, next: any) {
  if (!authorized(req)) return res.status(401).json({ error: "Website integration authentication required" });
  next();
}

function stockSql(variantId: string) {
  return Number((sqliteConn!.prepare(`SELECT COALESCE(SUM(CASE WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity ELSE 0 END),0) stock FROM stock_ledger WHERE variant_id=?`).get(variantId) as any)?.stock || 0);
}

function activeReservedSql(variantId: string, excludeOrderId?: string) {
  const q = excludeOrderId
    ? `SELECT COALESCE(SUM(quantity),0) q FROM website_stock_reservations WHERE variant_id=? AND status='RESERVED' AND expires_at>unixepoch() AND order_id<>?`
    : `SELECT COALESCE(SUM(quantity),0) q FROM website_stock_reservations WHERE variant_id=? AND status='RESERVED' AND expires_at>unixepoch()`;
  const row = excludeOrderId
    ? sqliteConn!.prepare(q).get(variantId, excludeOrderId)
    : sqliteConn!.prepare(q).get(variantId);
  return Number((row as any)?.q || 0);
}

function catalogRows() {
  const rows = sqliteConn!.prepare(`
    SELECT v.id variant_id,v.sku,v.barcode,v.color,v.size,v.fabric,v.selling_price,v.mrp,v.image_url variant_image_url,
           p.id product_id,p.name,p.description,p.image_url,p.brand,c.name category_name,c.gst_rate,
           wp.published,wp.website_price,wp.website_image_url,wp.website_description,wp.slug,wp.collections_json,wp.badge,wp.featured
    FROM product_variants v
    JOIN products p ON p.id=v.product_id
    JOIN categories c ON c.id=p.category_id
    LEFT JOIN website_products wp ON wp.variant_id=v.id
    WHERE v.active=1 AND p.active=1 AND COALESCE(wp.published,0)=1
    ORDER BY COALESCE(wp.featured,0) DESC,p.updated_at DESC,p.name,v.sku
  `).all() as any[];
  return rows.map(r => {
    const stock = stockSql(r.variant_id);
    const reserved = activeReservedSql(r.variant_id);
    return {
      id: r.variant_id, variantId: r.variant_id, productId: r.product_id, sku: r.sku, barcode: r.barcode,
      name: r.name, category: r.category_name, color: r.color || "", size: r.size || "", fabric: r.fabric || "",
      price: Number(r.website_price ?? r.selling_price), sellingPrice: Number(r.selling_price), mrp: r.mrp == null ? null : Number(r.mrp),
      image: r.website_image_url || r.variant_image_url || r.image_url || "",
      gallery: (() => { try { return JSON.parse(r.gallery_json || "[]"); } catch { return []; } })(),
      description: r.website_description || r.description || "", stock, availableStock: Math.max(0, stock - reserved),
      published: !!r.published, slug: r.slug || r.sku, collections: (() => { try { return JSON.parse(r.collections_json || "[]").collections || []; } catch { return []; } })(),
      badge: r.badge || "", featured: !!r.featured,
    };
  });
}

router.use(gate);

router.get("/catalog", (_req, res) => {
  const rows = sqliteConn!.prepare("SELECT key,value FROM settings").all() as any[];
  const settings:any = Object.fromEntries(rows.map(r=>[r.key,r.value]));
  settings.upi = settings.upi || process.env.BUSINESS_UPI_ID || "7976900021@pthdfc";
  settings.phone = settings.phone || process.env.BUSINESS_WHATSAPP_NUMBER || "7976900021";
  settings.address = settings.address || "प्लॉट नं. 9, राम नगर, मुर्तलीपुर, रोड नं. 2, बी.के.आई. के सामने, जयपुर";
  return res.json({ products: catalogRows(), settings, generatedAt: new Date().toISOString() });
});

const orderSchema = z.object({
  externalOrderId: z.string().min(1).max(120), customerName: z.string().min(1).max(120), customerPhone: z.string().min(8).max(20),
  total: z.number().nonnegative(), paymentMethod: z.enum(["UPI","COD"]).default("UPI"), shippingAddress: z.string().min(1).max(500),
  city: z.string().optional(), pincode: z.string().optional(), upiReference: z.string().optional(), qrExpiresAt: z.number().optional(),
  items: z.array(z.object({ variantId: z.string(), sku: z.string().optional(), quantity: z.number().int().positive(), rate: z.number().nonnegative(), lineTotal: z.number().nonnegative(), size: z.string().optional(), color: z.string().optional() })).min(1),
  payload: z.any().optional(),
});

router.post("/orders", (req, res) => {
  const d = orderSchema.safeParse(req.body);
  if (!d.success) return res.status(400).json({ error: "Invalid website order", details: d.error.flatten() });
  const db = sqliteConn!;
  try {
    const existing = db.prepare("SELECT * FROM website_orders WHERE external_order_id=?").get(d.data.externalOrderId) as any;
    if (existing) return res.json({ ok: true, duplicate: true, orderId: existing.id, status: existing.status, paymentStatus: existing.payment_status, qrExpiresAt: existing.qr_expires_at });

    let customerId: string | null = null;
    let draftInvoiceId: string | null = null;
    let createdCustomer = false;
    const existingCustomer = db.prepare("SELECT id FROM customers WHERE phone=?").get(d.data.customerPhone) as any;
    if (existingCustomer) customerId = existingCustomer.id;
    else {
      customerId = newId();
      createdCustomer = true;
      db.prepare(`INSERT INTO customers(id,name,phone,address_line,city,state,state_code,whatsapp_opt_in,created_at,updated_at) VALUES(?,?,?,?,?,'Rajasthan','08',1,unixepoch(),unixepoch())`)
        .run(customerId,d.data.customerName,d.data.customerPhone,d.data.shippingAddress,d.data.city||"Jaipur");
    }

    const systemUser = db.prepare("SELECT id FROM users WHERE role IN ('OWNER','ADMIN') AND active=1 ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END LIMIT 1").get() as any;
    if (!systemUser) throw new Error("No active owner/admin user is configured");

    const resolvedItems = d.data.items.map(item => {
      const row = db.prepare(`SELECT v.id variant_id,v.sku,v.color,v.size,v.selling_price,wp.website_price,wp.published FROM product_variants v LEFT JOIN website_products wp ON wp.variant_id=v.id WHERE v.id=? AND v.active=1`).get(item.variantId) as any;
      if (!row || !row.published) throw new Error(`Product ${item.sku || item.variantId} is not currently published online`);
      const customerPrice = Number(row.website_price ?? row.selling_price);
      const gstRate = Number((db.prepare(`SELECT COALESCE(p.gst_rate,c.gst_rate,5) gst FROM products p JOIN categories c ON c.id=p.category_id JOIN product_variants v ON v.product_id=p.id WHERE v.id=?`).get(item.variantId) as any)?.gst || 5);
      const rate = Math.round((customerPrice/(1+gstRate/100))*100)/100;
      return {...item, sku:row.sku, rate, customerPrice, lineTotal:customerPrice*item.quantity, color:row.color||"", size:row.size||""};
    });
    const serverTotal = resolvedItems.reduce((sum,item)=>sum+item.lineTotal,0);
    const draft = createInvoice({
      customerId, cashierId: systemUser.id, items: resolvedItems.map(i => ({ variantId:i.variantId, quantity:i.quantity, rate:i.rate })),
      paymentMode: d.data.paymentMethod === "COD" ? "CASH" : "UPI", amountPaid: 0, status: "DRAFT", notes: `Website order ${d.data.externalOrderId}`
    }) as any;

    draftInvoiceId = draft.id;
    db.prepare("UPDATE invoices SET website_order_id=? WHERE id=?").run(d.data.externalOrderId,draft.id);

    const expires = Math.floor(Date.now()/1000) + 120;
    const paymentStatus = "PENDING";
    const orderId = db.transaction(() => {
      for (const item of resolvedItems) {
        const stock = stockSql(item.variantId);
        const reserved = activeReservedSql(item.variantId);
        const available = stock - reserved;
        if (available < item.quantity) throw new Error(`Insufficient available stock for ${item.sku || item.variantId}: ${Math.max(0,available)} available`);
      }
      const id = newId();
      db.prepare(`INSERT INTO website_orders(id,external_order_id,customer_name,customer_phone,status,payment_status,total,payload,shipping_address,upi_reference,qr_expires_at,stock_reserved,invoice_id,customer_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch())`)
        .run(id,d.data.externalOrderId,d.data.customerName,d.data.customerPhone,"NEW",paymentStatus,serverTotal,JSON.stringify({...d.data.payload||{},city:d.data.city||"",pincode:d.data.pincode||"",paymentMethod:d.data.paymentMethod}),d.data.shippingAddress,d.data.upiReference||null,d.data.paymentMethod==="UPI"?expires:null,0,draft.id,customerId);
      for (const x of resolvedItems) {
        db.prepare(`INSERT INTO website_order_items(id,order_id,variant_id,sku,quantity,rate,line_total) VALUES(?,?,?,?,?,?,?)`).run(newId(),id,x.variantId,x.sku||null,x.quantity,x.customerPrice,x.lineTotal);
        db.prepare(`INSERT INTO website_stock_reservations(id,order_id,variant_id,quantity,status,expires_at,created_at,updated_at) VALUES(?,?,?,?, 'RESERVED',?,unixepoch(),unixepoch())`).run(newId(),id,x.variantId,x.quantity,d.data.paymentMethod==="UPI"?expires:Math.floor(Date.now()/1000)+86400);
      }
      return id;
    })();
    res.status(201).json({ ok:true, orderId, invoiceId:draft.id, total:serverTotal, paymentStatus, paymentMethod:d.data.paymentMethod, upiId:process.env.BUSINESS_UPI_ID||"7976900021@pthdfc", qrExpiresAt:d.data.paymentMethod==="UPI"?expires:null });
  } catch (e:any) {
    try {
      if (draftInvoiceId) {
        db.prepare("DELETE FROM invoice_item_salespersons WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id=?)").run(draftInvoiceId);
        db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(draftInvoiceId);
        db.prepare("DELETE FROM invoice_discounts WHERE invoice_id=?").run(draftInvoiceId);
        db.prepare("DELETE FROM payments WHERE invoice_id=?").run(draftInvoiceId);
        db.prepare("DELETE FROM invoices WHERE id=? AND status='DRAFT'").run(draftInvoiceId);
      }
      if (createdCustomer && customerId) db.prepare("DELETE FROM customers WHERE id=? AND NOT EXISTS (SELECT 1 FROM invoices WHERE customer_id=?)").run(customerId,customerId);
    } catch {}
    res.status(409).json({ error: e.message || "Could not create website order" });
  }
});

router.get("/orders/:id", (req, res) => {
  const o = sqliteConn!.prepare("SELECT * FROM website_orders WHERE id=? OR external_order_id=?").get(req.params.id,req.params.id) as any;
  if (!o) return res.status(404).json({error:"Order not found"});
  const items = sqliteConn!.prepare("SELECT * FROM website_order_items WHERE order_id=?").all(o.id);
  res.json({order:{...o,items}});
});

router.post("/orders/:id/cancel", (req,res)=>{
  try {
    const result=sqliteConn!.transaction(()=>{
      const o=sqliteConn!.prepare("SELECT * FROM website_orders WHERE id=? OR external_order_id=?").get(req.params.id,req.params.id) as any;
      if(!o)throw new Error("Order not found");
      if(o.stock_reserved)throw new Error("Confirmed orders must be cancelled by the POS operator so the stock return is audited");
      sqliteConn!.prepare("UPDATE website_stock_reservations SET status='RELEASED',updated_at=unixepoch() WHERE order_id=? AND status='RESERVED'").run(o.id);
      sqliteConn!.prepare("UPDATE website_orders SET status='CANCELLED',payment_status=CASE WHEN payment_status='PENDING' THEN 'FAILED' ELSE payment_status END,updated_at=unixepoch() WHERE id=?").run(o.id);
      const inv=sqliteConn!.prepare("SELECT invoice_id FROM website_orders WHERE id=?").get(o.id) as any;
      if(inv?.invoice_id){sqliteConn!.prepare("DELETE FROM invoice_item_salespersons WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id=?)").run(inv.invoice_id);sqliteConn!.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(inv.invoice_id);sqliteConn!.prepare("DELETE FROM invoice_discounts WHERE invoice_id=?").run(inv.invoice_id);sqliteConn!.prepare("DELETE FROM payments WHERE invoice_id=?").run(inv.invoice_id);sqliteConn!.prepare("DELETE FROM invoices WHERE id=? AND status='DRAFT'").run(inv.invoice_id);}
      return o.id;
    })(); return res.json({ok:true,id:result});
  }catch(e:any){res.status(400).json({error:e.message})}
});

export default router;
