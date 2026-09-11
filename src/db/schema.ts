// ============================================================
// Sarvani Suit and Saree — Database schema (Drizzle ORM)
//
// Dev DB: SQLite (better-sqlite3), file at backend/dev.db
// Production: swap to Postgres — see src/db/client.ts and README
// for the one-config-change instructions. Table/column shapes
// are compatible with both; only the client wiring changes.
// ============================================================
import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const id = () => text("id").primaryKey();
const ts = (name: string) => integer(name, { mode: "timestamp" });

// ---------------- Users / Auth ----------------
export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["OWNER", "ADMIN", "CASHIER", "INVENTORY"] }).notNull().default("CASHIER"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
});

// ---------------- Catalog ----------------
export const categories = sqliteTable("categories", {
  id: id(),
  name: text("name").notNull().unique(),
  hsnCode: text("hsn_code"),
  gstRate: real("gst_rate").notNull().default(5),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
});

export const products = sqliteTable("products", {
  id: id(),
  name: text("name").notNull(),
  categoryId: text("category_id").notNull().references(() => categories.id),
  hsnCode: text("hsn_code"),
  gstRate: real("gst_rate"),
  brand: text("brand"),
  description: text("description"),
  imageUrl: text("image_url"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  catIdx: index("products_category_idx").on(t.categoryId),
}));

export const productVariants = sqliteTable("product_variants", {
  id: id(),
  productId: text("product_id").notNull().references(() => products.id),
  sku: text("sku").notNull().unique(),
  barcode: text("barcode").unique(),
  color: text("color"),
  size: text("size"),
  fabric: text("fabric"),
  purchaseRate: real("purchase_rate").notNull().default(0),
  sellingPrice: real("selling_price").notNull(),
  minStockLevel: integer("min_stock_level").notNull().default(2),
  imageUrl: text("image_url"),
  gstType: text("gst_type").notNull().default("GST"),
  mrp: real("mrp"),
  sellingPriceInclusive: integer("selling_price_inclusive", {mode:"boolean"}).notNull().default(true),
  expiryDate: integer("expiry_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  prodIdx: index("variants_product_idx").on(t.productId),
}));

// ---------------- Stock Ledger (append-only source of truth) ----------------
export const stockLedger = sqliteTable("stock_ledger", {
  id: id(),
  variantId: text("variant_id").notNull().references(() => productVariants.id),
  type: text("type", {
    enum: ["PURCHASE_IN", "SALE_OUT", "SALE_RETURN_IN", "PURCHASE_RETURN_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "OPENING_STOCK"],
  }).notNull(),
  quantity: integer("quantity").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  note: text("note"),
  userId: text("user_id").references(() => users.id),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  variantIdx: index("ledger_variant_idx").on(t.variantId),
  refIdx: index("ledger_ref_idx").on(t.refType, t.refId),
}));

// ---------------- Customers (CRM) ----------------
export const customers = sqliteTable("customers", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  addressLine: text("address_line"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"),
  gstin: text("gstin"),
  birthday: ts("birthday"),
  anniversary: ts("anniversary"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  tags: text("tags"),
  notes: text("notes"),
  whatsappOptIn: integer("whatsapp_opt_in", { mode: "boolean" }).notNull().default(true),
  membershipId: text("membership_id"),
  creditLimit: real("credit_limit").notNull().default(0),
  lastVisitAt: ts("last_visit_at"),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  phoneIdx: index("customers_phone_idx").on(t.phone),
}));

// ---------------- Invoices ----------------
export const invoices = sqliteTable("invoices", {
  id: id(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  financialYear: text("financial_year").notNull(),
  customerId: text("customer_id").references(() => customers.id),
  cashierId: text("cashier_id").notNull().references(() => users.id),

  subTotal: real("sub_total").notNull().default(0),
  discountTotal: real("discount_total").notNull().default(0),
  taxableTotal: real("taxable_total").notNull().default(0),
  cgstTotal: real("cgst_total").notNull().default(0),
  sgstTotal: real("sgst_total").notNull().default(0),
  igstTotal: real("igst_total").notNull().default(0),
  roundOff: real("round_off").notNull().default(0),
  grandTotal: real("grand_total").notNull().default(0),

  placeOfSupplyStateCode: text("place_of_supply_state_code"),
  isInterState: integer("is_inter_state", { mode: "boolean" }).notNull().default(false),

  paymentMode: text("payment_mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }).notNull().default("CASH"),
  amountPaid: real("amount_paid").notNull().default(0),
  balanceDue: real("balance_due").notNull().default(0),

  status: text("status", { enum: ["DRAFT", "COMPLETED", "CANCELLED", "RETURNED", "PARTIALLY_RETURNED"] }).notNull().default("COMPLETED"),
  notes: text("notes"),
  counterId: text("counter_id"),
  membershipId: text("membership_id"),
  couponId: text("coupon_id"),
  discountLayersJson: text("discount_layers_json"),
  websiteOrderId: text("website_order_id"),

  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  custIdx: index("invoices_customer_idx").on(t.customerId),
  createdIdx: index("invoices_created_idx").on(t.createdAt),
  statusIdx: index("invoices_status_idx").on(t.status),
}));

export const invoiceItems = sqliteTable("invoice_items", {
  id: id(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  variantId: text("variant_id").notNull().references(() => productVariants.id),
  description: text("description").notNull(),
  hsnCode: text("hsn_code"),
  quantity: integer("quantity").notNull(),
  rate: real("rate").notNull(),
  discountPct: real("discount_pct").notNull().default(0),
  discountAmt: real("discount_amt").notNull().default(0),
  taxableValue: real("taxable_value").notNull(),
  gstRate: real("gst_rate").notNull(),
  cgstAmt: real("cgst_amt").notNull().default(0),
  sgstAmt: real("sgst_amt").notNull().default(0),
  igstAmt: real("igst_amt").notNull().default(0),
  lineTotal: real("line_total").notNull(),
  returnedQty: integer("returned_qty").notNull().default(0),
  discountLayersJson: text("discount_layers_json"),
  salesmanAllocationComplete: integer("salesman_allocation_complete", { mode: "boolean" }).notNull().default(false),
}, (t) => ({
  invIdx: index("items_invoice_idx").on(t.invoiceId),
  varIdx: index("items_variant_idx").on(t.variantId),
}));

export const payments = sqliteTable("payments", {
  id: id(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  mode: text("mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }).notNull(),
  amount: real("amount").notNull(),
  reference: text("reference"),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  invIdx: index("payments_invoice_idx").on(t.invoiceId),
}));

export const invoiceReturns = sqliteTable("invoice_returns", {
  id: id(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  reason: text("reason"),
  refundMode: text("refund_mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }),
  refundAmt: real("refund_amt").notNull().default(0),
  userId: text("user_id"),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  invIdx: index("returns_invoice_idx").on(t.invoiceId),
}));

// ---------------- Purchases / Suppliers ----------------
export const suppliers = sqliteTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  gstin: text("gstin"),
  address: text("address"),
  stateCode: text("state_code"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
});

export const purchases = sqliteTable("purchases", {
  id: id(),
  purchaseNumber: text("purchase_number").notNull().unique(),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id),
  invoiceRefNo: text("invoice_ref_no"),
  status: text("status", { enum: ["DRAFT", "RECEIVED", "CANCELLED"] }).notNull().default("RECEIVED"),
  subTotal: real("sub_total").notNull().default(0),
  taxTotal: real("tax_total").notNull().default(0),
  grandTotal: real("grand_total").notNull().default(0),
  paidAmount: real("paid_amount").notNull().default(0),
  balanceDue: real("balance_due").notNull().default(0),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  notes: text("notes"),
}, (t) => ({
  supIdx: index("purchases_supplier_idx").on(t.supplierId),
}));

export const purchaseItems = sqliteTable("purchase_items", {
  id: id(),
  purchaseId: text("purchase_id").notNull().references(() => purchases.id),
  variantId: text("variant_id").notNull().references(() => productVariants.id),
  quantity: integer("quantity").notNull(),
  rate: real("rate").notNull(),
  gstRate: real("gst_rate").notNull().default(0),
  taxableValue: real("taxable_value").notNull(),
  taxAmount: real("tax_amount").notNull(),
  lineTotal: real("line_total").notNull(),
}, (t) => ({
  purIdx: index("purchase_items_purchase_idx").on(t.purchaseId),
  varIdx: index("purchase_items_variant_idx").on(t.variantId),
}));

// ---------------- Accounting support ----------------
export const expenseCategories = sqliteTable("expense_categories", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const expenses = sqliteTable("expenses", {
  id: id(),
  categoryId: text("category_id").notNull().references(() => expenseCategories.id),
  amount: real("amount").notNull(),
  description: text("description"),
  paymentMode: text("payment_mode", { enum: ["CASH", "UPI", "CARD", "CREDIT", "BANK_TRANSFER", "MIXED"] }).notNull().default("CASH"),
  createdById: text("created_by_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  catIdx: index("expenses_category_idx").on(t.categoryId),
}));

// ---------------- Invoice number counters ----------------
export const counters = sqliteTable("counters", {
  id: text("id").primaryKey(), // e.g. "INVOICE-2026-27"
  lastValue: integer("last_value").notNull().default(0),
});

// ---------------- Audit log ----------------
export const auditLogs = sqliteTable("audit_logs", {
  id: id(),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  userIdx: index("audit_user_idx").on(t.userId),
  entityIdx: index("audit_entity_idx").on(t.entity, t.entityId),
}));


// ---------------- Website master integration ----------------
export const websiteProducts = sqliteTable("website_products", {
  id: id(),
  variantId: text("variant_id").notNull().references(() => productVariants.id).unique(),
  published: integer("published", {mode:"boolean"}).notNull().default(false),
  websitePrice: real("website_price"),
  websiteImageUrl: text("website_image_url"),
  websiteDescription: text("website_description"),
  slug: text("slug").unique(),
  collectionsJson: text("collections_json"),
  galleryJson: text("gallery_json"),
  badge: text("badge"),
  featured: integer("featured", {mode:"boolean"}).notNull().default(false),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
});

export const websiteOrders = sqliteTable("website_orders", {
  id: id(),
  externalOrderId: text("external_order_id").unique(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  status: text("status").notNull().default("NEW"),
  paymentStatus: text("payment_status").notNull().default("PENDING"),
  total: real("total").notNull().default(0),
  payload: text("payload"),
  shippingAddress: text("shipping_address"),
  upiReference: text("upi_reference"),
  qrExpiresAt: integer("qr_expires_at"),
  stockReserved: integer("stock_reserved", {mode:"boolean"}).notNull().default(false),
  invoiceId: text("invoice_id"),
  customerId: text("customer_id"),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
});

export const websiteStockReservations = sqliteTable("website_stock_reservations", {
  id: id(),
  orderId: text("order_id").notNull().references(() => websiteOrders.id),
  variantId: text("variant_id").notNull().references(() => productVariants.id),
  quantity: integer("quantity").notNull(),
  status: text("status").notNull().default("RESERVED"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  updatedAt: ts("updated_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  variantIdx: index("website_reservation_variant_idx").on(t.variantId, t.status, t.expiresAt),
}));

// ---------------- WhatsApp automation log ----------------
export const waMessageLog = sqliteTable("wa_message_log", {
  id: id(),
  customerId: text("customer_id").references(() => customers.id),
  invoiceId: text("invoice_id").references(() => invoices.id),
  toNumber: text("to_number").notNull(),
  type: text("type", {
    enum: ["INVOICE_RECEIPT", "PAYMENT_REMINDER", "BIRTHDAY_WISH", "ANNIVERSARY_WISH", "LOW_STOCK_ALERT", "NEW_ARRIVAL_PROMO", "CUSTOM"],
  }).notNull(),
  templateName: text("template_name"),
  body: text("body"),
  status: text("status", { enum: ["PENDING", "SENT", "FAILED"] }).notNull().default("PENDING"),
  errorMsg: text("error_msg"),
  createdAt: ts("created_at").notNull().default(sql`(unixepoch())`),
  sentAt: ts("sent_at"),
}, (t) => ({
  custIdx: index("wa_customer_idx").on(t.customerId),
  statusIdx: index("wa_status_idx").on(t.status),
}));
