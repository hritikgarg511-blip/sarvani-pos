// Simple, dependency-light migration runner for the SQLite dev DB.
// Creates all tables directly from raw SQL (kept in sync with schema.ts).
// For production Postgres, use `drizzle-kit generate` + `drizzle-kit migrate`
// (see README) which gives you versioned migration files.
import "dotenv/config";
import Database from "better-sqlite3";

const dbPath = process.env.SQLITE_PATH || "./dev.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const sql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CASHIER',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  hsn_code TEXT,
  gst_rate REAL NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  hsn_code TEXT,
  gst_rate REAL,
  brand TEXT,
  description TEXT,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id);

CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  color TEXT,
  size TEXT,
  fabric TEXT,
  purchase_rate REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL,
  min_stock_level INTEGER NOT NULL DEFAULT 2,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON product_variants(product_id);

CREATE TABLE IF NOT EXISTS stock_ledger (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  note TEXT,
  user_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS ledger_variant_idx ON stock_ledger(variant_id);
CREATE INDEX IF NOT EXISTS ledger_ref_idx ON stock_ledger(ref_type, ref_id);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  address_line TEXT,
  city TEXT,
  state TEXT,
  state_code TEXT,
  gstin TEXT,
  birthday INTEGER,
  anniversary INTEGER,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  notes TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  financial_year TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  cashier_id TEXT NOT NULL REFERENCES users(id),
  sub_total REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  taxable_total REAL NOT NULL DEFAULT 0,
  cgst_total REAL NOT NULL DEFAULT 0,
  sgst_total REAL NOT NULL DEFAULT 0,
  igst_total REAL NOT NULL DEFAULT 0,
  round_off REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  place_of_supply_state_code TEXT,
  is_inter_state INTEGER NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  amount_paid REAL NOT NULL DEFAULT 0,
  balance_due REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS invoices_customer_idx ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  description TEXT NOT NULL,
  hsn_code TEXT,
  quantity INTEGER NOT NULL,
  rate REAL NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_amt REAL NOT NULL DEFAULT 0,
  taxable_value REAL NOT NULL,
  gst_rate REAL NOT NULL,
  cgst_amt REAL NOT NULL DEFAULT 0,
  sgst_amt REAL NOT NULL DEFAULT 0,
  igst_amt REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL,
  returned_qty INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_invoice_idx ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS items_variant_idx ON invoice_items(variant_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  mode TEXT NOT NULL,
  amount REAL NOT NULL,
  reference TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS invoice_returns (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  reason TEXT,
  refund_mode TEXT,
  refund_amt REAL NOT NULL DEFAULT 0,
  user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS returns_invoice_idx ON invoice_returns(invoice_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  address TEXT,
  state_code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  invoice_ref_no TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  sub_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  balance_due REAL NOT NULL DEFAULT 0,
  created_by_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS purchases_supplier_idx ON purchases(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL,
  rate REAL NOT NULL,
  gst_rate REAL NOT NULL DEFAULT 0,
  taxable_value REAL NOT NULL,
  tax_amount REAL NOT NULL,
  line_total REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS purchase_items_variant_idx ON purchase_items(variant_id);

CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  amount REAL NOT NULL,
  description TEXT,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  created_by_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses(category_id);

CREATE TABLE IF NOT EXISTS counters (
  id TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS wa_message_log (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  invoice_id TEXT REFERENCES invoices(id),
  to_number TEXT NOT NULL,
  type TEXT NOT NULL,
  template_name TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  error_msg TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS wa_customer_idx ON wa_message_log(customer_id);
CREATE INDEX IF NOT EXISTS wa_status_idx ON wa_message_log(status);

CREATE TABLE IF NOT EXISTS staff_profiles (
  id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), commission_per_piece REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT, discount_type TEXT NOT NULL DEFAULT 'PERCENT', discount_value REAL NOT NULL DEFAULT 0, min_bill REAL NOT NULL DEFAULT 0, max_discount REAL, start_at INTEGER, end_at INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS coupon_assignments (id TEXT PRIMARY KEY, coupon_id TEXT NOT NULL REFERENCES coupons(id), customer_id TEXT NOT NULL REFERENCES customers(id), assigned_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(coupon_id,customer_id));
CREATE TABLE IF NOT EXISTS stock_journal (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), journal_type TEXT NOT NULL, quantity INTEGER NOT NULL, note TEXT, user_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS invoice_item_salespersons (
  id TEXT PRIMARY KEY, invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id), user_id TEXT NOT NULL REFERENCES users(id), quantity INTEGER NOT NULL, UNIQUE(invoice_item_id,user_id)
);
CREATE TABLE IF NOT EXISTS website_products (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL UNIQUE REFERENCES product_variants(id), published INTEGER NOT NULL DEFAULT 0, website_price REAL, website_image_url TEXT, website_description TEXT, slug TEXT UNIQUE, updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS website_orders (
  id TEXT PRIMARY KEY, external_order_id TEXT UNIQUE, customer_name TEXT, customer_phone TEXT, status TEXT NOT NULL DEFAULT 'NEW', payment_status TEXT NOT NULL DEFAULT 'PENDING', total REAL NOT NULL DEFAULT 0, payload TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS wa_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, body TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS backup_log (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS payment_reminders (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), due_date INTEGER, last_sent_at INTEGER, active INTEGER NOT NULL DEFAULT 1);

`;


// V4 feature tables/columns. These are additive so existing installations can be upgraded safely.
const addColumn = (table: string, column: string, definition: string) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (_) { /* already exists */ }
};
addColumn('counters','name','TEXT');
addColumn('counters','prefix','TEXT');
addColumn('counters','location','TEXT');
addColumn('counters','active','INTEGER NOT NULL DEFAULT 1');
addColumn('products','website_slug','TEXT');
addColumn('product_variants','image_url','TEXT');
addColumn('product_variants','gst_type','TEXT NOT NULL DEFAULT \'GST\'');
addColumn('product_variants','mrp','REAL');
addColumn('product_variants','selling_price_inclusive','INTEGER NOT NULL DEFAULT 1');
addColumn('product_variants','expiry_date','INTEGER');
addColumn('invoices','counter_id','TEXT');
addColumn('invoices','membership_id','TEXT');
addColumn('invoices','coupon_id','TEXT');
addColumn('invoices','discount_layers_json','TEXT');
addColumn('invoices','website_order_id','TEXT');
addColumn('invoice_items','discount_layers_json','TEXT');
addColumn('invoice_items','salesman_allocation_complete','INTEGER NOT NULL DEFAULT 0');
addColumn('customers','membership_id','TEXT');
addColumn('customers','credit_limit','REAL NOT NULL DEFAULT 0');
addColumn('customers','last_visit_at','INTEGER');
addColumn('purchases','gst_type','TEXT NOT NULL DEFAULT \'INPUT\'');
addColumn('website_orders','shipping_address','TEXT');
addColumn('website_orders','upi_reference','TEXT');
addColumn('website_orders','qr_expires_at','INTEGER');
addColumn('website_orders','stock_reserved','INTEGER NOT NULL DEFAULT 0');
addColumn('website_orders','invoice_id','TEXT');
addColumn('website_orders','customer_id','TEXT');
addColumn('website_products','collections_json','TEXT');
addColumn('website_products','badge','TEXT');
addColumn('website_products','featured','INTEGER NOT NULL DEFAULT 0');
addColumn('website_products','gallery_json','TEXT');

try { db.exec(`CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, discount_pct REAL NOT NULL DEFAULT 0,
  points_multiplier REAL NOT NULL DEFAULT 1, min_spend REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS customer_memberships (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), membership_id TEXT NOT NULL REFERENCES memberships(id),
  start_at INTEGER NOT NULL DEFAULT (unixepoch()), end_at INTEGER, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(customer_id,membership_id)
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS invoice_discounts (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), sequence_no INTEGER NOT NULL,
  discount_type TEXT NOT NULL, value REAL NOT NULL, amount REAL NOT NULL, label TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS barcode_catalog (
  code TEXT PRIMARY KEY, product_variant_id TEXT REFERENCES product_variants(id), status TEXT NOT NULL DEFAULT 'AVAILABLE', source TEXT NOT NULL DEFAULT 'SYSTEM', created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS counter_sessions (
  id TEXT PRIMARY KEY, counter_id TEXT NOT NULL REFERENCES counters(id), user_id TEXT NOT NULL REFERENCES users(id), opened_at INTEGER NOT NULL DEFAULT (unixepoch()), closed_at INTEGER, opening_cash REAL NOT NULL DEFAULT 0, closing_cash REAL, status TEXT NOT NULL DEFAULT 'OPEN'
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS website_order_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES website_orders(id), variant_id TEXT REFERENCES product_variants(id), sku TEXT, quantity INTEGER NOT NULL, rate REAL NOT NULL, line_total REAL NOT NULL
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS website_stock_reservations (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES website_orders(id), variant_id TEXT NOT NULL REFERENCES product_variants(id), quantity INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'RESERVED', expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(order_id,variant_id)
)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS website_stock_reservation_idx ON website_stock_reservations(variant_id,status,expires_at)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS website_sync_log (
  id TEXT PRIMARY KEY, direction TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, status TEXT NOT NULL, message TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), processed_at INTEGER
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS gst_tax_profiles (
  code TEXT PRIMARY KEY, label TEXT NOT NULL, category TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS legacy_accounts (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,parent TEXT,op_balance REAL NOT NULL DEFAULT 0,state_name TEXT,gstin TEXT,dealer_type TEXT,source_code TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()))`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS import_runs (id TEXT PRIMARY KEY,source TEXT NOT NULL UNIQUE,record_counts TEXT,created_at INTEGER NOT NULL DEFAULT (unixepoch()))`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'DRAFT',created_by_id TEXT REFERENCES users(id),created_at INTEGER NOT NULL DEFAULT (unixepoch()),sent_at INTEGER)`); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS daily_closings (
  id TEXT PRIMARY KEY, business_date TEXT NOT NULL UNIQUE, sales REAL NOT NULL DEFAULT 0, cash REAL NOT NULL DEFAULT 0, upi REAL NOT NULL DEFAULT 0, card REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, expenses REAL NOT NULL DEFAULT 0, net REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS barcode_catalog_variant_idx ON barcode_catalog(product_variant_id)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS sync_queue_status_idx ON sync_queue(status,created_at)`); } catch (_) {}
try { db.exec(`INSERT OR IGNORE INTO gst_tax_profiles(code,label,category) VALUES
('CGST','CGST','OUTPUT'),('SGST','SGST','OUTPUT'),('IGST','Regular IGST','OUTPUT'),
('INPUT','Input GST','INPUT'),('SGST_INPUT','SGST Input','INPUT'),('CGST_INPUT','CGST Input','INPUT'),
('IGST_ITC_NON','IGST ITC non','COMPOSITION'),('SGST_ITC_NON','SGST ITC non','COMPOSITION'),('CGST_ITC_NON','CGST ITC non','COMPOSITION')`); } catch (_) {}
try { db.exec(`INSERT OR IGNORE INTO expense_categories(id,name) VALUES ('default-rent','Rent'),('default-salary','Salary'),('default-electricity','Electricity'),('default-transport','Transport'),('default-other','Other')`); } catch (_) {}

db.exec(sql);
console.log(`Migration complete. Tables created in ${dbPath}`);
db.close();
