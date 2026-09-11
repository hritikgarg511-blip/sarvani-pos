"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InsufficientStockError = void 0;
exports.createInvoice = createInvoice;
exports.getInvoiceById = getInvoiceById;
exports.finalizeDraftInvoice = finalizeDraftInvoice;
const client_1 = require("../db/client");
const id_1 = require("../lib/id");
const gst_1 = require("../lib/gst");
const invoiceNumber_1 = require("../lib/invoiceNumber");
class InsufficientStockError extends Error {
    constructor(variantSku, available, requested) {
        super(`Insufficient stock for ${variantSku}: available ${available}, requested ${requested}`);
        this.variantSku = variantSku;
        this.available = available;
        this.requested = requested;
        this.name = "InsufficientStockError";
    }
}
exports.InsufficientStockError = InsufficientStockError;
function getVariantWithStock(variantId, excludeReservationOrderId) {
    const variant = client_1.sqliteConn
        .prepare(`SELECT v.*, p.name as product_name, p.hsn_code as product_hsn, p.gst_rate as product_gst_rate,
              c.gst_rate as category_gst_rate, c.hsn_code as category_hsn
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN categories c ON c.id = p.category_id
       WHERE v.id = ?`)
        .get(variantId);
    if (!variant)
        return null;
    const stockRow = client_1.sqliteConn
        .prepare(`SELECT COALESCE(SUM(
          CASE
            WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity
            WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity
            ELSE 0
          END
        ), 0) as stock
       FROM stock_ledger WHERE variant_id = ?`)
        .get(variantId);
    const effectiveGstRate = variant.product_gst_rate ?? variant.category_gst_rate ?? 5;
    const hsnCode = variant.product_hsn || variant.category_hsn || null;
    const reservedRow = client_1.sqliteConn.prepare(excludeReservationOrderId
        ? `SELECT COALESCE(SUM(quantity),0) reserved FROM website_stock_reservations WHERE variant_id=? AND status='RESERVED' AND expires_at>unixepoch() AND order_id<>?`
        : `SELECT COALESCE(SUM(quantity),0) reserved FROM website_stock_reservations WHERE variant_id=? AND status='RESERVED' AND expires_at>unixepoch()`).get(...(excludeReservationOrderId ? [variantId, excludeReservationOrderId] : [variantId]));
    const reserved = Number(reservedRow?.reserved || 0);
    return {
        ...variant,
        currentStock: Math.max(0, Number(stockRow.stock || 0) - reserved),
        effectiveGstRate,
        hsnCode,
    };
}
function insertStockMove(params) {
    const stockRow = client_1.sqliteConn
        .prepare(`SELECT COALESCE(SUM(
          CASE
            WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity
            WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity
            ELSE 0
          END
        ), 0) as stock
       FROM stock_ledger WHERE variant_id = ?`)
        .get(params.variantId);
    const isInbound = ["PURCHASE_IN", "SALE_RETURN_IN", "ADJUSTMENT_IN", "OPENING_STOCK"].includes(params.type);
    const balanceAfter = stockRow.stock + (isInbound ? params.quantity : -params.quantity);
    client_1.sqliteConn
        .prepare(`INSERT INTO stock_ledger (id, variant_id, type, quantity, balance_after, ref_type, ref_id, note, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`)
        .run((0, id_1.newId)(), params.variantId, params.type, params.quantity, balanceAfter, params.refType, params.refId, params.note || null, params.userId || null);
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
function createInvoice(input) {
    if (!client_1.sqliteConn)
        throw new Error("createInvoice requires the SQLite dev connection");
    if (!input.items.length)
        throw new Error("Invoice must have at least one item");
    const tx = client_1.sqliteConn.transaction(() => {
        let customerStateCode = null;
        if (input.customerId) {
            const cust = client_1.sqliteConn
                .prepare(`SELECT state_code FROM customers WHERE id = ?`)
                .get(input.customerId);
            customerStateCode = cust?.state_code || null;
        }
        const interState = (0, gst_1.isInterStateSupply)(customerStateCode);
        const invoiceId = (0, id_1.newId)();
        const lineRows = [];
        let subTotal = 0;
        let discountTotal = 0;
        let taxableTotal = 0;
        let cgstTotal = 0;
        let sgstTotal = 0;
        let igstTotal = 0;
        for (const item of input.items) {
            const variant = getVariantWithStock(item.variantId);
            if (!variant)
                throw new Error(`Variant not found: ${item.variantId}`);
            if (!variant.active)
                throw new Error(`Variant is inactive: ${variant.sku}`);
            if (input.status === "COMPLETED" && variant.currentStock < item.quantity) {
                throw new InsufficientStockError(variant.sku, variant.currentStock, item.quantity);
            }
            const rate = item.rate ?? (0, gst_1.round2)(variant.selling_price / (1 + variant.effectiveGstRate / 100));
            const gross = (0, gst_1.round2)(rate * item.quantity);
            const layers = [...(item.discountLayers || [])];
            if (item.discountPct && item.discountPct > 0 && !layers.length)
                layers.push({ type: "PERCENT", value: item.discountPct, label: "Discount 1" });
            let base = gross;
            let layerDiscount = 0;
            const applied = [];
            for (const layer of layers) {
                const amount = layer.type === "PERCENT" ? (0, gst_1.round2)(base * layer.value / 100) : Math.min(base, (0, gst_1.round2)(layer.value));
                base = (0, gst_1.round2)(base - amount);
                layerDiscount = (0, gst_1.round2)(layerDiscount + amount);
                applied.push({ type: layer.type, value: layer.value, label: layer.label || `Discount ${applied.length + 1}`, amount });
            }
            const taxableValue = base;
            let cgstAmt = 0, sgstAmt = 0, igstAmt = 0;
            if (interState)
                igstAmt = (0, gst_1.round2)(taxableValue * variant.effectiveGstRate / 100);
            else {
                cgstAmt = (0, gst_1.round2)(taxableValue * (variant.effectiveGstRate / 2) / 100);
                sgstAmt = (0, gst_1.round2)(taxableValue * (variant.effectiveGstRate / 2) / 100);
            }
            const lineTotal = (0, gst_1.round2)(taxableValue + cgstAmt + sgstAmt + igstAmt);
            subTotal += gross;
            discountTotal += layerDiscount;
            taxableTotal += taxableValue;
            cgstTotal += cgstAmt;
            sgstTotal += sgstAmt;
            igstTotal += igstAmt;
            lineRows.push({
                id: (0, id_1.newId)(),
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
        const invoiceDiscountRows = [];
        if (input.membershipId) {
            const m = client_1.sqliteConn.prepare(`SELECT * FROM memberships WHERE id=? AND active=1`).get(input.membershipId);
            if (m && m.discount_pct > 0 && m.min_spend <= subTotal) {
                invoiceLevelDiscount = (0, gst_1.round2)(taxableTotal * m.discount_pct / 100);
                taxableTotal = (0, gst_1.round2)(taxableTotal - invoiceLevelDiscount);
                if (interState)
                    igstTotal = (0, gst_1.round2)(igstTotal - igstTotal * m.discount_pct / 100);
                else {
                    cgstTotal = (0, gst_1.round2)(cgstTotal - cgstTotal * m.discount_pct / 100);
                    sgstTotal = (0, gst_1.round2)(sgstTotal - sgstTotal * m.discount_pct / 100);
                }
                invoiceDiscountRows.push({ sequenceNo: 1, discountType: "PERCENT", value: m.discount_pct, amount: invoiceLevelDiscount, label: `Membership: ${m.name}` });
            }
        }
        if (input.couponId || input.couponCode) {
            const coupon = client_1.sqliteConn.prepare(`SELECT * FROM coupons WHERE active=1 AND (id=? OR code=?)`).get(input.couponId || null, input.couponCode || null);
            if (coupon && subTotal >= Number(coupon.min_bill || 0) && (!coupon.start_at || coupon.start_at <= Math.floor(Date.now() / 1000)) && (!coupon.end_at || coupon.end_at >= Math.floor(Date.now() / 1000))) {
                let cd = coupon.discount_type === "PERCENT" ? (0, gst_1.round2)(taxableTotal * coupon.discount_value / 100) : Math.min(taxableTotal, (0, gst_1.round2)(coupon.discount_value));
                if (coupon.max_discount != null)
                    cd = Math.min(cd, Number(coupon.max_discount));
                taxableTotal = (0, gst_1.round2)(taxableTotal - cd);
                if (interState)
                    igstTotal = (0, gst_1.round2)(igstTotal * (1 - cd / (taxableTotal + cd || 1)));
                else {
                    const old = taxableTotal + cd;
                    cgstTotal = (0, gst_1.round2)(cgstTotal * (taxableTotal / old));
                    sgstTotal = (0, gst_1.round2)(sgstTotal * (taxableTotal / old));
                }
                discountTotal = (0, gst_1.round2)(discountTotal + cd);
                invoiceDiscountRows.push({ sequenceNo: invoiceDiscountRows.length + 1, discountType: coupon.discount_type, value: coupon.discount_value, amount: cd, label: `Coupon: ${coupon.code}` });
            }
            else if (input.couponId || input.couponCode)
                throw new Error("Coupon is invalid, expired, or minimum bill not met");
        }
        const rawGrandTotal = (0, gst_1.round2)(taxableTotal + cgstTotal + sgstTotal + igstTotal);
        const grandTotal = Math.round(rawGrandTotal); // round off to nearest rupee, standard retail practice
        const roundOff = (0, gst_1.round2)(grandTotal - rawGrandTotal);
        const fy = (0, invoiceNumber_1.currentFinancialYear)();
        const invoiceNumber = input.status === "COMPLETED" ? (0, invoiceNumber_1.nextInvoiceNumber)(fy) : `DRAFT-${invoiceId.slice(0, 8)}`;
        const balanceDue = input.status === "COMPLETED" ? (0, gst_1.round2)(grandTotal - input.amountPaid) : 0;
        client_1.sqliteConn
            .prepare(`INSERT INTO invoices (
          id, invoice_number, financial_year, customer_id, cashier_id,
          sub_total, discount_total, taxable_total, cgst_total, sgst_total, igst_total, round_off, grand_total,
          place_of_supply_state_code, is_inter_state, payment_mode, amount_paid, balance_due, status, notes, counter_id, membership_id, coupon_id, discount_layers_json,
          created_at, updated_at
        ) VALUES (?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?, unixepoch(), unixepoch())`)
            .run(invoiceId, invoiceNumber, fy, input.customerId || null, input.cashierId, subTotal, discountTotal, taxableTotal, cgstTotal, sgstTotal, igstTotal, roundOff, grandTotal, customerStateCode, interState ? 1 : 0, input.paymentMode, input.status === "COMPLETED" ? input.amountPaid : 0, balanceDue, input.status, input.notes || null, input.counterId || null, input.membershipId || null, input.couponId || null, JSON.stringify(invoiceDiscountRows));
        for (const line of lineRows) {
            client_1.sqliteConn
                .prepare(`INSERT INTO invoice_items (
            id, invoice_id, variant_id, description, hsn_code, quantity, rate,
            discount_pct, discount_amt, taxable_value, gst_rate, cgst_amt, sgst_amt, igst_amt, line_total, returned_qty, discount_layers_json
          ) VALUES (?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,0,?)`)
                .run(line.id, invoiceId, line.variantId, line.description, line.hsnCode, line.quantity, line.rate, line.discountPct, line.discountAmt, line.taxableValue, line.gstRate, line.cgstAmt, line.sgstAmt, line.igstAmt, line.lineTotal, JSON.stringify(line.discountLayers || []));
            if (input.salesmanAllocations?.length) {
                const alloc = input.salesmanAllocations.find(a => a.variantId === line.variantId);
                if (alloc) {
                    const totalAlloc = alloc.allocations.reduce((sum, a) => sum + a.quantity, 0);
                    if (totalAlloc !== line.quantity)
                        throw new Error(`Salesman allocation for ${line.description} must equal ${line.quantity}`);
                    for (const a of alloc.allocations)
                        client_1.sqliteConn.prepare(`INSERT INTO invoice_item_salespersons(id,invoice_item_id,user_id,quantity) VALUES(?,?,?,?)`).run((0, id_1.newId)(), line.id, a.userId, a.quantity);
                    client_1.sqliteConn.prepare(`UPDATE invoice_items SET salesman_allocation_complete=1 WHERE id=?`).run(line.id);
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
            for (const d of invoiceDiscountRows)
                client_1.sqliteConn.prepare(`INSERT INTO invoice_discounts(id,invoice_id,sequence_no,discount_type,value,amount,label) VALUES(?,?,?,?,?,?,?)`).run((0, id_1.newId)(), invoiceId, d.sequenceNo, d.discountType, d.value, d.amount, d.label);
        }
        if (input.status === "COMPLETED") {
            const paymentRows = input.payments && input.payments.length
                ? input.payments
                : [{ mode: input.paymentMode, amount: input.amountPaid }];
            const paidSum = (0, gst_1.round2)(paymentRows.reduce((sum, p) => sum + Number(p.amount || 0), 0));
            if (paidSum > grandTotal + 0.01)
                throw new Error("Payment cannot exceed grand total");
            if (input.paymentMode !== "CREDIT" && input.paymentMode !== "MIXED" && paidSum + 0.01 < grandTotal)
                throw new Error("Payment is less than grand total; use Credit or Mixed for an outstanding balance");
            if (input.customerId && paidSum < grandTotal) {
                const cust = client_1.sqliteConn.prepare(`SELECT credit_limit FROM customers WHERE id=?`).get(input.customerId);
                const existing = client_1.sqliteConn.prepare(`SELECT COALESCE(SUM(balance_due),0) b FROM invoices WHERE customer_id=? AND status='COMPLETED'`).get(input.customerId).b;
                if (Number(cust?.credit_limit || 0) > 0 && Number(existing) + grandTotal - paidSum > Number(cust.credit_limit))
                    throw new Error("Customer credit limit exceeded");
            }
            for (const p of paymentRows) {
                client_1.sqliteConn
                    .prepare(`INSERT INTO payments (id, invoice_id, mode, amount, reference, created_at) VALUES (?,?,?,?,?, unixepoch())`)
                    .run((0, id_1.newId)(), invoiceId, p.mode, p.amount, p.reference || null);
            }
            if (input.customerId) {
                const pointsEarned = Math.floor(grandTotal / 100); // 1 point per Rs 100 spent
                client_1.sqliteConn
                    .prepare(`UPDATE customers SET loyalty_points = loyalty_points + ?, updated_at = unixepoch() WHERE id = ?`)
                    .run(pointsEarned, input.customerId);
                client_1.sqliteConn.prepare(`UPDATE customers SET last_visit_at=unixepoch(), updated_at=unixepoch() WHERE id=?`).run(input.customerId);
            }
        }
        return invoiceId;
    });
    const invoiceId = tx();
    return getInvoiceById(invoiceId);
}
function getInvoiceById(invoiceId) {
    if (!client_1.sqliteConn)
        throw new Error("requires SQLite dev connection");
    const invoice = client_1.sqliteConn.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId);
    if (!invoice)
        return null;
    const items = client_1.sqliteConn.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(invoiceId);
    const payments = client_1.sqliteConn.prepare(`SELECT * FROM payments WHERE invoice_id = ?`).all(invoiceId);
    return { ...invoice, items, payments };
}
/** Finalizes a previously held (DRAFT) invoice: revalidates stock, deducts it, allocates a real invoice number. */
function finalizeDraftInvoice(invoiceId, payments, cashierId, excludeReservationOrderId) {
    if (!client_1.sqliteConn)
        throw new Error("requires SQLite dev connection");
    const tx = client_1.sqliteConn.transaction(() => {
        const invoice = client_1.sqliteConn.prepare(`SELECT * FROM invoices WHERE id = ?`).get(invoiceId);
        if (!invoice)
            throw new Error("Invoice not found");
        if (invoice.status !== "DRAFT")
            throw new Error("Only DRAFT invoices can be finalized");
        const items = client_1.sqliteConn.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(invoiceId);
        for (const item of items) {
            const variant = getVariantWithStock(item.variant_id, excludeReservationOrderId);
            if (!variant)
                throw new Error(`Variant not found: ${item.variant_id}`);
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
        const fy = invoice.financial_year || (0, invoiceNumber_1.currentFinancialYear)();
        const invoiceNumber = (0, invoiceNumber_1.nextInvoiceNumber)(fy);
        const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
        const balanceDue = (0, gst_1.round2)(invoice.grand_total - amountPaid);
        client_1.sqliteConn
            .prepare(`UPDATE invoices SET invoice_number = ?, status = 'COMPLETED', amount_paid = ?, balance_due = ?, updated_at = unixepoch() WHERE id = ?`)
            .run(invoiceNumber, amountPaid, balanceDue, invoiceId);
        for (const p of payments) {
            client_1.sqliteConn
                .prepare(`INSERT INTO payments (id, invoice_id, mode, amount, reference, created_at) VALUES (?,?,?,?,?, unixepoch())`)
                .run((0, id_1.newId)(), invoiceId, p.mode, p.amount, p.reference || null);
        }
        return invoiceId;
    });
    const id = tx();
    return getInvoiceById(id);
}
//# sourceMappingURL=posService.js.map