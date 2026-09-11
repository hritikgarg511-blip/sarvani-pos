"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waMessageLog = exports.websiteStockReservations = exports.websiteOrders = exports.websiteProducts = exports.auditLogs = exports.counters = exports.expenses = exports.expenseCategories = exports.purchaseItems = exports.purchases = exports.suppliers = exports.invoiceReturns = exports.payments = exports.invoiceItems = exports.invoices = exports.customers = exports.stockLedger = exports.productVariants = exports.products = exports.categories = exports.users = void 0;
// ============================================================
// Sarvani Suit and Saree — Database schema (Drizzle ORM)
//
// Dev DB: SQLite (better-sqlite3), file at backend/dev.db
// Production: swap to Postgres — see src/db/client.ts and README
// for the one-config-change instructions. Table/column shapes
// are compatible with both; only the client wiring changes.
// ============================================================
const sqlite_core_1 = require("drizzle-orm/sqlite-core");
const drizzle_orm_1 = require("drizzle-orm");
const id = () => (0, sqlite_core_1.text)("id").primaryKey();
const ts = (name) => (0, sqlite_core_1.integer)(name, { mode: "timestamp" });
// ---------------- Users / Auth ----------------
exports.users = (0, sqlite_core_1.sqliteTable)("users", {
    id: id(),
    name: (0, sqlite_core_1.text)("name").notNull(),
    phone: (0, sqlite_core_1.text)("phone").notNull().unique(),
    email: (0, sqlite_core_1.text)("email").unique(),
    passwordHash: (0, sqlite_core_1.text)("password_hash").notNull(),
    role: (0, sqlite_core_1.text)("role", { enum: ["OWNER", "ADMIN", "CASHIER", "INVENTORY"] }).notNull().default("CASHIER"),
    active: (0, sqlite_core_1.integer)("active", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
});
// ---------------- Catalog ----------------
exports.categories = (0, sqlite_core_1.sqliteTable)("categories", {
    id: id(),
    name: (0, sqlite_core_1.text)("name").notNull().unique(),
    hsnCode: (0, sqlite_core_1.text)("hsn_code"),
    gstRate: (0, sqlite_core_1.real)("gst_rate").notNull().default(5),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
});
exports.products = (0, sqlite_core_1.sqliteTable)("products", {
    id: id(),
    name: (0, sqlite_core_1.text)("name").notNull(),
    categoryId: (0, sqlite_core_1.text)("category_id").notNull().references(() => exports.categories.id),
    hsnCode: (0, sqlite_core_1.text)("hsn_code"),
    gstRate: (0, sqlite_core_1.real)("gst_rate"),
    brand: (0, sqlite_core_1.text)("brand"),
    description: (0, sqlite_core_1.text)("description"),
    imageUrl: (0, sqlite_core_1.text)("image_url"),
    active: (0, sqlite_core_1.integer)("active", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    catIdx: (0, sqlite_core_1.index)("products_category_idx").on(t.categoryId),
}));
exports.productVariants = (0, sqlite_core_1.sqliteTable)("product_variants", {
    id: id(),
    productId: (0, sqlite_core_1.text)("product_id").notNull().references(() => exports.products.id),
    sku: (0, sqlite_core_1.text)("sku").notNull().unique(),
    barcode: (0, sqlite_core_1.text)("barcode").unique(),
    color: (0, sqlite_core_1.text)("color"),
    size: (0, sqlite_core_1.text)("size"),
    fabric: (0, sqlite_core_1.text)("fabric"),
    purchaseRate: (0, sqlite_core_1.real)("purchase_rate").notNull().default(0),
    sellingPrice: (0, sqlite_core_1.real)("selling_price").notNull(),
    minStockLevel: (0, sqlite_core_1.integer)("min_stock_level").notNull().default(2),
    imageUrl: (0, sqlite_core_1.text)("image_url"),
    gstType: (0, sqlite_core_1.text)("gst_type").notNull().default("GST"),
    mrp: (0, sqlite_core_1.real)("mrp"),
    sellingPriceInclusive: (0, sqlite_core_1.integer)("selling_price_inclusive", { mode: "boolean" }).notNull().default(true),
    expiryDate: (0, sqlite_core_1.integer)("expiry_date"),
    active: (0, sqlite_core_1.integer)("active", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    prodIdx: (0, sqlite_core_1.index)("variants_product_idx").on(t.productId),
}));
// ---------------- Stock Ledger (append-only source of truth) ----------------
exports.stockLedger = (0, sqlite_core_1.sqliteTable)("stock_ledger", {
    id: id(),
    variantId: (0, sqlite_core_1.text)("variant_id").notNull().references(() => exports.productVariants.id),
    type: (0, sqlite_core_1.text)("type", {
        enum: ["PURCHASE_IN", "SALE_OUT", "SALE_RETURN_IN", "PURCHASE_RETURN_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "OPENING_STOCK"],
    }).notNull(),
    quantity: (0, sqlite_core_1.integer)("quantity").notNull(),
    balanceAfter: (0, sqlite_core_1.integer)("balance_after").notNull(),
    refType: (0, sqlite_core_1.text)("ref_type"),
    refId: (0, sqlite_core_1.text)("ref_id"),
    note: (0, sqlite_core_1.text)("note"),
    userId: (0, sqlite_core_1.text)("user_id").references(() => exports.users.id),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    variantIdx: (0, sqlite_core_1.index)("ledger_variant_idx").on(t.variantId),
    refIdx: (0, sqlite_core_1.index)("ledger_ref_idx").on(t.refType, t.refId),
}));
// ---------------- Customers (CRM) ----------------
exports.customers = (0, sqlite_core_1.sqliteTable)("customers", {
    id: id(),
    name: (0, sqlite_core_1.text)("name").notNull(),
    phone: (0, sqlite_core_1.text)("phone").notNull().unique(),
    email: (0, sqlite_core_1.text)("email"),
    addressLine: (0, sqlite_core_1.text)("address_line"),
    city: (0, sqlite_core_1.text)("city"),
    state: (0, sqlite_core_1.text)("state"),
    stateCode: (0, sqlite_core_1.text)("state_code"),
    gstin: (0, sqlite_core_1.text)("gstin"),
    birthday: ts("birthday"),
    anniversary: ts("anniversary"),
    loyaltyPoints: (0, sqlite_core_1.integer)("loyalty_points").notNull().default(0),
    tags: (0, sqlite_core_1.text)("tags"),
    notes: (0, sqlite_core_1.text)("notes"),
    whatsappOptIn: (0, sqlite_core_1.integer)("whatsapp_opt_in", { mode: "boolean" }).notNull().default(true),
    membershipId: (0, sqlite_core_1.text)("membership_id"),
    creditLimit: (0, sqlite_core_1.real)("credit_limit").notNull().default(0),
    lastVisitAt: ts("last_visit_at"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    phoneIdx: (0, sqlite_core_1.index)("customers_phone_idx").on(t.phone),
}));
// ---------------- Invoices ----------------
exports.invoices = (0, sqlite_core_1.sqliteTable)("invoices", {
    id: id(),
    invoiceNumber: (0, sqlite_core_1.text)("invoice_number").notNull().unique(),
    financialYear: (0, sqlite_core_1.text)("financial_year").notNull(),
    customerId: (0, sqlite_core_1.text)("customer_id").references(() => exports.customers.id),
    cashierId: (0, sqlite_core_1.text)("cashier_id").notNull().references(() => exports.users.id),
    subTotal: (0, sqlite_core_1.real)("sub_total").notNull().default(0),
    discountTotal: (0, sqlite_core_1.real)("discount_total").notNull().default(0),
    taxableTotal: (0, sqlite_core_1.real)("taxable_total").notNull().default(0),
    cgstTotal: (0, sqlite_core_1.real)("cgst_total").notNull().default(0),
    sgstTotal: (0, sqlite_core_1.real)("sgst_total").notNull().default(0),
    igstTotal: (0, sqlite_core_1.real)("igst_total").notNull().default(0),
    roundOff: (0, sqlite_core_1.real)("round_off").notNull().default(0),
    grandTotal: (0, sqlite_core_1.real)("grand_total").notNull().default(0),
    placeOfSupplyStateCode: (0, sqlite_core_1.text)("place_of_supply_state_code"),
    isInterState: (0, sqlite_core_1.integer)("is_inter_state", { mode: "boolean" }).notNull().default(false),
    paymentMode: (0, sqlite_core_1.text)("payment_mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }).notNull().default("CASH"),
    amountPaid: (0, sqlite_core_1.real)("amount_paid").notNull().default(0),
    balanceDue: (0, sqlite_core_1.real)("balance_due").notNull().default(0),
    status: (0, sqlite_core_1.text)("status", { enum: ["DRAFT", "COMPLETED", "CANCELLED", "RETURNED", "PARTIALLY_RETURNED"] }).notNull().default("COMPLETED"),
    notes: (0, sqlite_core_1.text)("notes"),
    counterId: (0, sqlite_core_1.text)("counter_id"),
    membershipId: (0, sqlite_core_1.text)("membership_id"),
    couponId: (0, sqlite_core_1.text)("coupon_id"),
    discountLayersJson: (0, sqlite_core_1.text)("discount_layers_json"),
    websiteOrderId: (0, sqlite_core_1.text)("website_order_id"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    custIdx: (0, sqlite_core_1.index)("invoices_customer_idx").on(t.customerId),
    createdIdx: (0, sqlite_core_1.index)("invoices_created_idx").on(t.createdAt),
    statusIdx: (0, sqlite_core_1.index)("invoices_status_idx").on(t.status),
}));
exports.invoiceItems = (0, sqlite_core_1.sqliteTable)("invoice_items", {
    id: id(),
    invoiceId: (0, sqlite_core_1.text)("invoice_id").notNull().references(() => exports.invoices.id),
    variantId: (0, sqlite_core_1.text)("variant_id").notNull().references(() => exports.productVariants.id),
    description: (0, sqlite_core_1.text)("description").notNull(),
    hsnCode: (0, sqlite_core_1.text)("hsn_code"),
    quantity: (0, sqlite_core_1.integer)("quantity").notNull(),
    rate: (0, sqlite_core_1.real)("rate").notNull(),
    discountPct: (0, sqlite_core_1.real)("discount_pct").notNull().default(0),
    discountAmt: (0, sqlite_core_1.real)("discount_amt").notNull().default(0),
    taxableValue: (0, sqlite_core_1.real)("taxable_value").notNull(),
    gstRate: (0, sqlite_core_1.real)("gst_rate").notNull(),
    cgstAmt: (0, sqlite_core_1.real)("cgst_amt").notNull().default(0),
    sgstAmt: (0, sqlite_core_1.real)("sgst_amt").notNull().default(0),
    igstAmt: (0, sqlite_core_1.real)("igst_amt").notNull().default(0),
    lineTotal: (0, sqlite_core_1.real)("line_total").notNull(),
    returnedQty: (0, sqlite_core_1.integer)("returned_qty").notNull().default(0),
    discountLayersJson: (0, sqlite_core_1.text)("discount_layers_json"),
    salesmanAllocationComplete: (0, sqlite_core_1.integer)("salesman_allocation_complete", { mode: "boolean" }).notNull().default(false),
}, (t) => ({
    invIdx: (0, sqlite_core_1.index)("items_invoice_idx").on(t.invoiceId),
    varIdx: (0, sqlite_core_1.index)("items_variant_idx").on(t.variantId),
}));
exports.payments = (0, sqlite_core_1.sqliteTable)("payments", {
    id: id(),
    invoiceId: (0, sqlite_core_1.text)("invoice_id").notNull().references(() => exports.invoices.id),
    mode: (0, sqlite_core_1.text)("mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }).notNull(),
    amount: (0, sqlite_core_1.real)("amount").notNull(),
    reference: (0, sqlite_core_1.text)("reference"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    invIdx: (0, sqlite_core_1.index)("payments_invoice_idx").on(t.invoiceId),
}));
exports.invoiceReturns = (0, sqlite_core_1.sqliteTable)("invoice_returns", {
    id: id(),
    invoiceId: (0, sqlite_core_1.text)("invoice_id").notNull().references(() => exports.invoices.id),
    reason: (0, sqlite_core_1.text)("reason"),
    refundMode: (0, sqlite_core_1.text)("refund_mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }),
    refundAmt: (0, sqlite_core_1.real)("refund_amt").notNull().default(0),
    userId: (0, sqlite_core_1.text)("user_id"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    invIdx: (0, sqlite_core_1.index)("returns_invoice_idx").on(t.invoiceId),
}));
// ---------------- Purchases / Suppliers ----------------
exports.suppliers = (0, sqlite_core_1.sqliteTable)("suppliers", {
    id: id(),
    name: (0, sqlite_core_1.text)("name").notNull(),
    phone: (0, sqlite_core_1.text)("phone"),
    email: (0, sqlite_core_1.text)("email"),
    gstin: (0, sqlite_core_1.text)("gstin"),
    address: (0, sqlite_core_1.text)("address"),
    stateCode: (0, sqlite_core_1.text)("state_code"),
    active: (0, sqlite_core_1.integer)("active", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
});
exports.purchases = (0, sqlite_core_1.sqliteTable)("purchases", {
    id: id(),
    purchaseNumber: (0, sqlite_core_1.text)("purchase_number").notNull().unique(),
    supplierId: (0, sqlite_core_1.text)("supplier_id").notNull().references(() => exports.suppliers.id),
    invoiceRefNo: (0, sqlite_core_1.text)("invoice_ref_no"),
    status: (0, sqlite_core_1.text)("status", { enum: ["DRAFT", "RECEIVED", "CANCELLED"] }).notNull().default("RECEIVED"),
    subTotal: (0, sqlite_core_1.real)("sub_total").notNull().default(0),
    taxTotal: (0, sqlite_core_1.real)("tax_total").notNull().default(0),
    grandTotal: (0, sqlite_core_1.real)("grand_total").notNull().default(0),
    paidAmount: (0, sqlite_core_1.real)("paid_amount").notNull().default(0),
    balanceDue: (0, sqlite_core_1.real)("balance_due").notNull().default(0),
    createdById: (0, sqlite_core_1.text)("created_by_id").notNull().references(() => exports.users.id),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    notes: (0, sqlite_core_1.text)("notes"),
}, (t) => ({
    supIdx: (0, sqlite_core_1.index)("purchases_supplier_idx").on(t.supplierId),
}));
exports.purchaseItems = (0, sqlite_core_1.sqliteTable)("purchase_items", {
    id: id(),
    purchaseId: (0, sqlite_core_1.text)("purchase_id").notNull().references(() => exports.purchases.id),
    variantId: (0, sqlite_core_1.text)("variant_id").notNull().references(() => exports.productVariants.id),
    quantity: (0, sqlite_core_1.integer)("quantity").notNull(),
    rate: (0, sqlite_core_1.real)("rate").notNull(),
    gstRate: (0, sqlite_core_1.real)("gst_rate").notNull().default(0),
    taxableValue: (0, sqlite_core_1.real)("taxable_value").notNull(),
    taxAmount: (0, sqlite_core_1.real)("tax_amount").notNull(),
    lineTotal: (0, sqlite_core_1.real)("line_total").notNull(),
}, (t) => ({
    purIdx: (0, sqlite_core_1.index)("purchase_items_purchase_idx").on(t.purchaseId),
    varIdx: (0, sqlite_core_1.index)("purchase_items_variant_idx").on(t.variantId),
}));
// ---------------- Accounting support ----------------
exports.expenseCategories = (0, sqlite_core_1.sqliteTable)("expense_categories", {
    id: id(),
    name: (0, sqlite_core_1.text)("name").notNull().unique(),
});
exports.expenses = (0, sqlite_core_1.sqliteTable)("expenses", {
    id: id(),
    categoryId: (0, sqlite_core_1.text)("category_id").notNull().references(() => exports.expenseCategories.id),
    amount: (0, sqlite_core_1.real)("amount").notNull(),
    description: (0, sqlite_core_1.text)("description"),
    paymentMode: (0, sqlite_core_1.text)("payment_mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }).notNull().default("CASH"),
    createdById: (0, sqlite_core_1.text)("created_by_id").notNull().references(() => exports.users.id),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    catIdx: (0, sqlite_core_1.index)("expenses_category_idx").on(t.categoryId),
}));
// ---------------- Invoice number counters ----------------
exports.counters = (0, sqlite_core_1.sqliteTable)("counters", {
    id: (0, sqlite_core_1.text)("id").primaryKey(), // e.g. "INVOICE-2026-27"
    lastValue: (0, sqlite_core_1.integer)("last_value").notNull().default(0),
});
// ---------------- Audit log ----------------
exports.auditLogs = (0, sqlite_core_1.sqliteTable)("audit_logs", {
    id: id(),
    userId: (0, sqlite_core_1.text)("user_id").references(() => exports.users.id),
    action: (0, sqlite_core_1.text)("action").notNull(),
    entity: (0, sqlite_core_1.text)("entity"),
    entityId: (0, sqlite_core_1.text)("entity_id"),
    details: (0, sqlite_core_1.text)("details"),
    ipAddress: (0, sqlite_core_1.text)("ip_address"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    userIdx: (0, sqlite_core_1.index)("audit_user_idx").on(t.userId),
    entityIdx: (0, sqlite_core_1.index)("audit_entity_idx").on(t.entity, t.entityId),
}));
// ---------------- Website master integration ----------------
exports.websiteProducts = (0, sqlite_core_1.sqliteTable)("website_products", {
    id: id(),
    variantId: (0, sqlite_core_1.text)("variant_id").notNull().references(() => exports.productVariants.id).unique(),
    published: (0, sqlite_core_1.integer)("published", { mode: "boolean" }).notNull().default(false),
    websitePrice: (0, sqlite_core_1.real)("website_price"),
    websiteImageUrl: (0, sqlite_core_1.text)("website_image_url"),
    websiteDescription: (0, sqlite_core_1.text)("website_description"),
    slug: (0, sqlite_core_1.text)("slug").unique(),
    collectionsJson: (0, sqlite_core_1.text)("collections_json"),
    galleryJson: (0, sqlite_core_1.text)("gallery_json"),
    badge: (0, sqlite_core_1.text)("badge"),
    featured: (0, sqlite_core_1.integer)("featured", { mode: "boolean" }).notNull().default(false),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
});
exports.websiteOrders = (0, sqlite_core_1.sqliteTable)("website_orders", {
    id: id(),
    externalOrderId: (0, sqlite_core_1.text)("external_order_id").unique(),
    customerName: (0, sqlite_core_1.text)("customer_name"),
    customerPhone: (0, sqlite_core_1.text)("customer_phone"),
    status: (0, sqlite_core_1.text)("status").notNull().default("NEW"),
    paymentStatus: (0, sqlite_core_1.text)("payment_status").notNull().default("PENDING"),
    total: (0, sqlite_core_1.real)("total").notNull().default(0),
    payload: (0, sqlite_core_1.text)("payload"),
    shippingAddress: (0, sqlite_core_1.text)("shipping_address"),
    upiReference: (0, sqlite_core_1.text)("upi_reference"),
    qrExpiresAt: (0, sqlite_core_1.integer)("qr_expires_at"),
    stockReserved: (0, sqlite_core_1.integer)("stock_reserved", { mode: "boolean" }).notNull().default(false),
    invoiceId: (0, sqlite_core_1.text)("invoice_id"),
    customerId: (0, sqlite_core_1.text)("customer_id"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
});
exports.websiteStockReservations = (0, sqlite_core_1.sqliteTable)("website_stock_reservations", {
    id: id(),
    orderId: (0, sqlite_core_1.text)("order_id").notNull().references(() => exports.websiteOrders.id),
    variantId: (0, sqlite_core_1.text)("variant_id").notNull().references(() => exports.productVariants.id),
    quantity: (0, sqlite_core_1.integer)("quantity").notNull(),
    status: (0, sqlite_core_1.text)("status").notNull().default("RESERVED"),
    expiresAt: (0, sqlite_core_1.integer)("expires_at").notNull(),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    updatedAt: ts("updated_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
}, (t) => ({
    variantIdx: (0, sqlite_core_1.index)("website_reservation_variant_idx").on(t.variantId, t.status, t.expiresAt),
}));
// ---------------- WhatsApp automation log ----------------
exports.waMessageLog = (0, sqlite_core_1.sqliteTable)("wa_message_log", {
    id: id(),
    customerId: (0, sqlite_core_1.text)("customer_id").references(() => exports.customers.id),
    invoiceId: (0, sqlite_core_1.text)("invoice_id").references(() => exports.invoices.id),
    toNumber: (0, sqlite_core_1.text)("to_number").notNull(),
    type: (0, sqlite_core_1.text)("type", {
        enum: ["INVOICE_RECEIPT", "PAYMENT_REMINDER", "BIRTHDAY_WISH", "ANNIVERSARY_WISH", "LOW_STOCK_ALERT", "NEW_ARRIVAL_PROMO", "CUSTOM"],
    }).notNull(),
    templateName: (0, sqlite_core_1.text)("template_name"),
    body: (0, sqlite_core_1.text)("body"),
    status: (0, sqlite_core_1.text)("status", { enum: ["PENDING", "SENT", "FAILED"] }).notNull().default("PENDING"),
    errorMsg: (0, sqlite_core_1.text)("error_msg"),
    createdAt: ts("created_at").notNull().default((0, drizzle_orm_1.sql) `(unixepoch())`),
    sentAt: ts("sent_at"),
}, (t) => ({
    custIdx: (0, sqlite_core_1.index)("wa_customer_idx").on(t.customerId),
    statusIdx: (0, sqlite_core_1.index)("wa_status_idx").on(t.status),
}));
//# sourceMappingURL=schema.js.map