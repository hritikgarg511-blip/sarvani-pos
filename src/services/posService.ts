import { sqliteConn } from "../db/client";
import { newId } from "../lib/id";
import { computeLineTax, round2, isInterStateSupply } from "../lib/gst";
import { currentFinancialYear, nextInvoiceNumber } from "../lib/invoiceNumber";

export interface InvoiceItemInput {
  variantId: string;
  quantity: number;
  rate?: number; // ex-GST unit rate; if omitted, derived from variant.sellingPrice / (1+gst/100)
  discountPct?: number;
  discountLayers?: { type: "PERCENT" | "FLAT"; value: number; label?: string }[];
}

export interface CreateInvoiceInput {
  customerId?: string | null;
  cashierId: string;
  items: InvoiceItemInput[];
  paymentMode: "CASH" | "UPI" | "CARD" | "CREDIT" | "BANK_TRANSFER" | "MIXED";
  amountPaid: number;
  status: "DRAFT" | "COMPLETED";
  notes?: string;
  payments?: { mode: string; amount: number; reference?: string }[];
  counterId?: string | null;
  membershipId?: string | null;
  couponId?: string | null;
  couponCode?: string | null;
  salesmanAllocations?: {variantId:string;allocations:{userId:string;quantity:number}[]}[];
}

export class InsufficientStockError extends Error {
  constructor(public variantSku: string, public available: number, public requested: number) {
    super(`Insufficient stock for ${variantSku}: available ${available}, requested ${requested}`);
    this.name = "InsufficientStockError";
  }
}

function getVariantWithStock(variantId: string, excludeReservationOrderId?: string) {
  const variant = sqliteConn!
    .prepare(
      `SELECT v.*, p.name as product_name, p.hsn_code as product_hsn, p.gst_rate as product_gst_rate,
              c.gst_rate as category_gst_rate, c.hsn_code as category_hsn
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE v.id = ?`
    )
    .get(variantId) as any;
  if (!variant) return null;

  const stockRow = sqliteConn!
    .prepare(
      `SELECT COALESCE(SUM(
          CASE
            WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity
            WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity
            ELSE 0
          END
        ), 0) as stock
       FROM stock_ledger WHERE variant_id = ?`
    )
    .get(variantId) as { stock: number };

  const effectiveGstRate = variant.product_gst_rate ?? variant.category_gst_rate ?? 5;
  const hsnCode = variant.product_hsn || variant.category_hsn || null;

  const reservedRow = sqliteConn!.prepare(
    excludeReservationOrderId
      ? `SELECT COALESCE(SUM(quantity),0) reserved FROM website_stock_reservations WHERE variant_id=? AND status='RESERVED' AND expires_at>unixepoch() AND order_id<>?`
      : `SELECT COALESCE(SUM(quantity),0) reserved FROM website_stock_reservations WHERE variant_id=? AND status='RESERVED' AND expires_at>unixepoch()`
  ).get(...(excludeReservationOrderId ? [variantId, excludeReservationOrderId] : [variantId])) as any;
  const reserved = Number(reservedRow?.reserved || 0);

  return {
    ...variant,
    currentStock: Math.max(0, Number(stockRow.stock || 0) - reserved),
    effectiveGstRate,
    hsnCode,
  };
}

function insertStockMove(params: {
  variantId: string;
  type: string;
  quantity: number;
  refType: string;
  refId: string;
  userId?: string | null;
  note?: string;
}) {
  const stockRow = sqliteConn!
    .prepare(
      `SELECT COALESCE(SUM(
          CASE
            WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity
            WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity
            ELSE 0
          END
        ), 0) as stock
       FROM stock_ledger WHERE variant_id = ?`
    )
    .get(params.variantId) as { stock: number };

  const isInbound = ["PURCHASE_IN", "SALE_RETURN_IN", "ADJUSTMENT_IN", "OPENING_STOCK"].includes(params.type);
  const balanceAfter = stockRow.stock + (isInbound ? params.quantity : -params.quantity);

  sqliteConn!
    .prepare(
      `INSERT INTO stock_ledger (id, variant_id, type, quantity, balance_after, ref_type, ref_id, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
    )
    .run(newId(), params.variantId, params.type, params.quantity, balanceAfter, params.refType, params.refId, params.note || null, params.userId || null);

  return balanceAfter;
}

/**
 * Creates an invoice. If status = COMPLETED, this:
 *  1. Validates stock for every line (inside the transaction, so it's checked
 *     against the true up-to-the-moment balance, not a stale read).
 *  2. Allocates the next GST invoice number atomically.
 *  3. Writes SALE_OUT stock ledger rows for every item.
 *  4. Writes the invoice, items, and payment record.
 * All of this happens in one SQLite transaction — if anything fails, nothing
 * is written (no partial bill, no phantom stock deduction).
 */
export function createInvoice(input: CreateInvoiceInput) {
  if (!sqliteConn) throw new Error("createInvoice requires the SQLite dev connection");
  if (!input.items.length) throw new Error("Invoice must have at least one item");

  const tx = sqliteConn.transaction(() => {
    let customerStateCode: string | null = null;
    if (input.customerId) {
      const cust = sqliteConn!
        .prepare(`SELECT state_code FROM customers WHERE id = ?`)
        .get(input.customerId) as { state_code: string | null } | undefined;
      customerStateCode = cust?.state_code || null;
    }
    const interState = isInterStateSupply(customerStateCode);

    const invoiceId = newId();
    const lineRows: any[] = [];
    let subTotal = 0;
    let discountTotal = 0;
    let taxableTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    for (const item of input.items) {
      const variant = getVariantWithStock(item.variantId);
      if (!variant) throw new Error(`Variant not found: ${item.variantId}`);
      if (!variant.active) throw new Error(`Variant is inactive: ${variant.sku}`);

      if (input.status === "COMPLETED" && variant.currentStock < item.quantity) {
        throw new InsufficientStockError(variant.sku, variant.currentStock, item.quantity);
      }

      const rate = item.rate ?? round2(variant.selling_price / (1 + variant.effectiveGstRate / 100));
      const gross = round2(rate * item.quantity);
      const layers = [...(item.discountLayers || [])];
      if (item.discountPct && item.discountPct > 0 && !layers.length) layers.push({type:"PERCENT",value:item.discountPct,label:"Discount 1"});
      let base = gross; let layerDiscount = 0;
      const applied:any[] = [];
      for (const layer of layers) {
        const amount = layer.type === "PERCENT" ? round2(base * layer.value / 100) : Math.min(base, round2(layer.value));
        base = round2(base - amount); layerDiscount = round2(layerDiscount + amount);
        applied.push({type:layer.type,value:layer.value,label:layer.label || `Discount ${applied.length+1}`,amount});
      }
      const taxableValue = base;
      let cgstAmt=0, sgstAmt=0, igstAmt=0;
      if (interState) igstAmt=round2(taxableValue * variant.effectiveGstRate / 100);
      else { cgstAmt=round2(taxableValue * (variant.effectiveGstRate/2) / 100); sgstAmt=round2(taxableValue * (variant.effectiveGstRate/2) / 100); }
      const lineTotal=round2(taxableValue+cgstAmt+sgstAmt+igstAmt);
      subTotal += gross; discountTotal += layerDiscount; taxableTotal += taxableValue;
      cgstTotal += cgstAmt; sgstTotal += sgstAmt; igstTotal += igstAmt;

      lineRows.push({
        id: newId(),
        variantId: item.variantId,
        description: `${variant.product_name}${variant.color ? " - " + variant.color : ""}${variant.size ? " - " + variant.size : ""}`,
        hsnCode: variant.hsnCode,
        quantity: item.quantity,
        rate,
        discountPct: item.discountPct || 0,
        discountAmt: layerDiscount,
        discountLayers: applied,
        taxableValue,
        gstRate: variant.effectiveGstRate,
        cgstAmt,
        sgstAmt,
        igstAmt,
        lineTotal,
      });
    }

    // Membership/coupon discounts are additional invoice-level discounts applied before tax.
    let invoiceLevelDiscount = 0;
    const invoiceDiscountRows:any[] = [];
    if (input.membershipId) {
      const m = sqliteConn!.prepare(`SELECT * FROM memberships WHERE id=? AND active=1`).get(input.membershipId) as any;
      if (m && m.discount_pct > 0 && m.min_spend <= subTotal) {
        invoiceLevelDiscount = round2(taxableTotal * m.discount_pct / 100);
        taxableTotal = round2(taxableTotal - invoiceLevelDiscount);
        if (interState) igstTotal = round2(igstTotal - igstTotal * m.discount_pct / 100);
        else { cgstTotal = round2(cgstTotal - cgstTotal * m.discount_pct / 100); sgstTotal = round2(sgstTotal - sgstTotal * m.discount_pct / 100); }
        invoiceDiscountRows.push({sequenceNo:1,discountType:"PERCENT",value:m.discount_pct,amount:invoiceLevelDiscount,label:`Membership: ${m.name}`});
      }
    }
    if (input.couponId || (input as any).couponCode) {
      const coupon = sqliteConn!.prepare(`SELECT * FROM coupons WHERE active=1 AND (id=? OR code=?)`).get(input.couponId||null,(input as any).couponCode||null) as any;
      if (coupon && subTotal >= Number(coupon.min_bill||0) && (!coupon.start_at || coupon.start_at<=Math.floor(Date.now()/1000)) && (!coupon.end_at || coupon.end_at>=Math.floor(Date.now()/1000))) {
        let cd = coupon.discount_type === "PERCENT" ? round2(taxableTotal * coupon.discount_value/100) : Math.min(taxableTotal,round2(coupon.discount_value));
        if (coupon.max_discount != null) cd=Math.min(cd,Number(coupon.max_discount));
        taxableTotal=round2(taxableTotal-cd);
        if(interState) igstTotal=round2(igstTotal*(1-cd/(taxableTotal+cd||1))); else { const old=taxableTotal+cd; cgstTotal=round2(cgstTotal*(taxableTotal/old)); sgstTotal=round2(sgstTotal*(taxableTotal/old)); }
        discountTotal=round2(discountTotal+cd);
        invoiceDiscountRows.push({sequenceNo:invoiceDiscountRows.length+1,discountType:coupon.discount_type,value:coupon.discount_value,amount:cd,label:`Coupon: ${coupon.code}`});
      } else if (input.couponId || (input as any).couponCode) throw new Error("Coupon is invalid, expired, or minimum bill not met");
    }
    const rawGrandTotal = round2(taxableTotal + cgstTotal + sgstTotal + igstTotal);
    const grandTotal = Math.round(rawGrandTotal); // round off to nearest rupee, standard retail practice
    const roundOff = round2(grandTotal - rawGrandTotal);

    const fy = currentFinancialYear();
    const invoiceNumber = input.status === "COMPLETED" ? nextInvoiceNumber(fy) : `DRAFT-${invoiceId.slice(0, 8)}`;

    const balanceDue = input.status === "COMPLETED" ? round2(grandTotal - input.amountPaid) : 0;

    sqliteConn!
      .prepare(
        `INSERT INTO invoices (
          id, invoice_number, financial_year, customer_id, cashier_id,
          sub_total, discount_total, taxable_total, cgst_total, sgst_total, igst_total, round_off, grand_total,
          place_of_supply_state_code, is_inter_state, payment_mode, amount_paid, balance_due, status, notes, counter_id, membership_id, coupon_id, discount_layers_json,
          created_at, updated_at
        ) VALUES (?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?, unixepoch(), unixepoch())`
      )
      .run(
        invoiceId,
        invoiceNumber,
        fy,
        input.customerId || null,
        input.cashierId,
        subTotal,
        discountTotal,
        taxableTotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        roundOff,
        grandTotal,
        customerStateCode,
        interState ? 1 : 0,
        input.paymentMode,
        input.status === "COMPLETED" ? input.amountPaid : 0,
        balanceDue,
        input.status,
        input.notes || null,
        input.counterId || null, input.membershipId || null, input.couponId || null, JSON.stringify(invoiceDiscountRows)
      );

    for (const line of lineRows) {
      sqliteConn!
        .prepare(
          `INSERT INTO invoice_items (
            id, invoice_id, variant_id, description, hsn_code, quantity, rate,
            discount_pct, discount_amt, taxable_value, gst_rate, cgst_amt, sgst_amt, igst_amt, line_total, returned_qty, discount_layers_json
          ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,0,?)`
        )
        .run(
          line.id,
          invoiceId,
          line.variantId,
          line.description,
          line.hsnCode,
          line.quantity,
          line.rate,
          line.discountPct,
          line.discountAmt,
          line.taxableValue,
          line.gstRate,
          line.cgstAmt,
          line.sgstAmt,
          line.igstAmt,
          line.lineTotal, JSON.stringify(line.discountLayers || [])
        );

      if (input.salesmanAllocations?.length) {
        const alloc = input.salesmanAllocations.find(a=>a.variantId===line.variantId);
        if (alloc) {
          const totalAlloc=alloc.allocations.reduce((sum,a)=>sum+a.quantity,0);
          if(totalAlloc!==line.quantity) throw new Error(`Salesman allocation for ${line.description} must equal ${line.quantity}`);
          for(const a of alloc.allocations) sqliteConn!.prepare(`INSERT INTO invoice_item_salespersons(id,invoice_item_id,user_id,quantity) VALUES(?,?,?,?)`).run(newId(),line.id,a.userId,a.quantity);
          sqliteConn!.prepare(`UPDATE invoice_items SET salesman_allocation_complete=1 WHERE id=?`).run(line.id);
        }
      }

      if (input.status === "COMPLETED") {
        insertStockMove({
          variantId: line.variantId,
          type: "SALE_OUT",
          quantity: line.quantity,
          refType: "INVOICE",
          refId: invoiceId,
          userId: input.cashierId,
        });
      }
    }

    if (invoiceDiscountRows.length) {
      for (const d of invoiceDiscountRows) sqliteConn!.prepare(`INSERT INTO invoice_discounts(id,invoice_id,sequence_no,discount_type,value,amount,label) VALUES(?,?,?,?,?,?,?)`).run(newId(),invoiceId,d.sequenceNo,d.discountType,d.value,d.amount,d.label);
    }

    if (input.status === "COMPLETED") {
      const paymentRows = input.payments && input.payments.length
        ? input.payments
        : [{ mode: input.paymentMode, amount: input.amountPaid }];
      const paidSum = round2(paymentRows.reduce((sum,p)=>sum+Number(p.amount||0),0));
      if (paidSum > grandTotal + 0.01) throw new Error("Payment cannot exceed grand total");
      if (input.paymentMode !== "CREDIT" && input.paymentMode !== "MIXED" && paidSum + 0.01 < grandTotal) throw new Error("Payment is less than grand total; use Credit or Mixed for an outstanding balance");
      if (input.customerId && paidSum < grandTotal) {
        const cust=sqliteConn!.prepare(`SELECT credit_limit FROM customers WHERE id=?`).get(input.customerId) as any;
        const existing=(sqliteConn!.prepare(`SELECT COALESCE(SUM(balance_due),0) b FROM invoices WHERE customer_id=? AND status='COMPLETED'`).get(input.customerId) as any).b;
        if (Number(cust?.credit_limit||0)>0 && Number(existing)+grandTotal-paidSum > Number(cust.credit_limit)) throw new Error("Customer credit limit exceeded");
      }
      for (const p of paymentRows) {
        sqliteConn!
          .prepare(
            `INSERT INTO payments (id, invoice_id, mode, amount, reference, created_at) VALUES (?,?,?,?,?, unixepoch())`
          )
          .run(newId(), invoiceId, p.mode, p.amount, (p as any).reference || null);
      }

      if (input.customerId) {
        const pointsEarned = Math.floor(grandTotal / 100); // 1 point per Rs 100 spent
        sqliteConn!
          .prepare(`UPDATE customers SET loyalty_points = loyalty_points + ?, updated_at = unixepoch() WHERE id = ?`)
          .run(pointsEarned, input.customerId);
        sqliteConn!.prepare(`UPDATE customers SET last_visit_at=unixepoch(), updated_at=unixepoch() WHERE id=?`).run(input.customerId);
      }
    }

    return invoiceId;
  });

  const invoiceId = tx();
  return getInvoiceById(invoiceId);
}

export function getInvoiceById(invoiceId: string) {
  if (!sqliteConn) throw new Error("requires SQLite dev connection");
  const invoice = sqliteConn.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId);
  if (!invoice) return null;
  const items = sqliteConn.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(invoiceId);
  const payments = sqliteConn.prepare(`SELECT * FROM payments WHERE invoice_id = ?`).all(invoiceId);
  return { ...(invoice as object), items, payments };
}

/** Finalizes a previously held (DRAFT) invoice: revalidates stock, deducts it, allocates a real invoice number. */
export function finalizeDraftInvoice(invoiceId: string, payments: { mode: string; amount: number; reference?: string }[], cashierId: string, excludeReservationOrderId?: string) {
  if (!sqliteConn) throw new Error("requires SQLite dev connection");

  const tx = sqliteConn.transaction(() => {
    const invoice = sqliteConn!.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId) as any;
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "DRAFT") throw new Error("Only DRAFT invoices can be finalized");

    const items = sqliteConn!.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(invoiceId) as any[];

    for (const item of items) {
      const variant = getVariantWithStock(item.variant_id, excludeReservationOrderId);
      if (!variant) throw new Error(`Variant not found: ${item.variant_id}`);
      if (variant.currentStock < item.quantity) {
        throw new InsufficientStockError(variant.sku, variant.currentStock, item.quantity);
      }
    }

    for (const item of items) {
      insertStockMove({
        variantId: item.variant_id,
        type: "SALE_OUT",
        quantity: item.quantity,
        refType: "INVOICE",
        refId: invoiceId,
        userId: cashierId,
      });
    }

    const fy = invoice.financial_year || currentFinancialYear();
    const invoiceNumber = nextInvoiceNumber(fy);
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const balanceDue = round2(invoice.grand_total - amountPaid);

    sqliteConn!
      .prepare(
        `UPDATE invoices SET invoice_number = ?, status = 'COMPLETED', amount_paid = ?, balance_due = ?, updated_at = unixepoch() WHERE id = ?`
      )
      .run(invoiceNumber, amountPaid, balanceDue, invoiceId);

    for (const p of payments) {
      sqliteConn!
        .prepare(`INSERT INTO payments (id, invoice_id, mode, amount, reference, created_at) VALUES (?,?,?,?,?, unixepoch())`)
        .run(newId(), invoiceId, p.mode, p.amount, p.reference || null);
    }

    return invoiceId;
  });

  const id = tx();
  return getInvoiceById(id);
}
