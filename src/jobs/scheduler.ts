import cron from "node-cron";
import fs from "fs";
import path from "path";
import { sqliteConn } from "../db/client";
import { newId } from "../lib/id";

function sendMetaWhatsApp(to:string, body:string): Promise<boolean> {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return Promise.resolve(false);
  return fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
    method:"POST", headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({messaging_product:"whatsapp",to:to.replace(/\D/g,""),type:"text",text:{body}})
  }).then(r=>r.ok).catch(()=>false);
}

async function queueAndTrySend(c:any,type:string,body:string){
  const db=sqliteConn!; const id=newId();
  db.prepare("INSERT INTO wa_message_log(id,customer_id,to_number,type,body,status,created_at) VALUES(?,?,?,?,?,'PENDING',unixepoch())").run(id,c.id,c.phone,type,body);
  if(await sendMetaWhatsApp(c.phone,body)) db.prepare("UPDATE wa_message_log SET status='SENT',sent_at=unixepoch() WHERE id=?").run(id);
}

export function startScheduler(){
  // Release expired online reservations and remove their unpaid draft invoice.
  cron.schedule("*/1 * * * *",()=>{try{const db=sqliteConn!;const rows=db.prepare(`SELECT DISTINCT order_id FROM website_stock_reservations WHERE status='RESERVED' AND expires_at<=unixepoch()`).all() as any[];for(const r of rows){db.transaction(()=>{const o=db.prepare("SELECT * FROM website_orders WHERE id=? AND stock_reserved=0 AND payment_status='PENDING'").get(r.order_id) as any;if(!o)return;db.prepare("UPDATE website_stock_reservations SET status='RELEASED',updated_at=unixepoch() WHERE order_id=? AND status='RESERVED'").run(o.id);db.prepare("UPDATE website_orders SET status='CANCELLED',payment_status='FAILED',updated_at=unixepoch() WHERE id=?").run(o.id);if(o.invoice_id){db.prepare("DELETE FROM invoice_item_salespersons WHERE invoice_item_id IN (SELECT id FROM invoice_items WHERE invoice_id=?)").run(o.invoice_id);db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(o.invoice_id);db.prepare("DELETE FROM invoice_discounts WHERE invoice_id=?").run(o.invoice_id);db.prepare("DELETE FROM payments WHERE invoice_id=?").run(o.invoice_id);db.prepare("DELETE FROM invoices WHERE id=? AND status='DRAFT'").run(o.invoice_id);}})()}}catch(e){console.error("[scheduler] reservation expiry",e)}});

  // Birthday + anniversary automation runs independently of the billing page being open.
  cron.schedule("0 8 * * *",async()=>{try{
    const db=sqliteConn!;
    const rows=db.prepare(`SELECT id,name,phone,birthday,anniversary,whatsapp_opt_in FROM customers WHERE whatsapp_opt_in=1 AND (strftime('%m-%d',birthday/1000,'unixepoch')=strftime('%m-%d','now','localtime') OR strftime('%m-%d',anniversary/1000,'unixepoch')=strftime('%m-%d','now','localtime'))`).all() as any[];
    for(const c of rows){
      if(c.birthday && new Date(c.birthday).toISOString().slice(5,10)===new Date().toISOString().slice(5,10)) await queueAndTrySend(c,"BIRTHDAY_WISH",`Happy Birthday ${c.name}! 🎉 Sarvani Suit and Saree wishes you a wonderful day. Enjoy a special offer from us today.`);
      if(c.anniversary && new Date(c.anniversary).toISOString().slice(5,10)===new Date().toISOString().slice(5,10)) await queueAndTrySend(c,"ANNIVERSARY_WISH",`Happy Anniversary ${c.name}! 💐 Warm wishes from Sarvani Suit and Saree. Enjoy a special offer from us today.`);
    }
  }catch(e){console.error("[scheduler] CRM job",e)}});

  // Deliver queued WhatsApp campaign/offer/e-billing messages when Meta credentials are configured.
  cron.schedule("*/2 * * * *",async()=>{try{const db=sqliteConn!;const rows=db.prepare(`SELECT * FROM wa_message_log WHERE status='PENDING' AND type NOT IN ('BIRTHDAY_WISH','ANNIVERSARY_WISH','PAYMENT_REMINDER') ORDER BY created_at LIMIT 50`).all() as any[];for(const m of rows){if(await sendMetaWhatsApp(m.to_number,m.body||''))db.prepare("UPDATE wa_message_log SET status='SENT',sent_at=unixepoch() WHERE id=?").run(m.id)}}catch(e){console.error("[scheduler] WhatsApp queue",e)}});

  // Outstanding reminders: queue one reminder every 7 days when due.
  cron.schedule("0 10 * * *",async()=>{try{const db=sqliteConn!;const rows=db.prepare(`SELECT r.*,i.balance_due,c.name,c.phone FROM payment_reminders r JOIN invoices i ON i.id=r.invoice_id JOIN customers c ON c.id=i.customer_id WHERE r.active=1 AND i.balance_due>0 AND (r.due_date IS NULL OR r.due_date<=unixepoch()) AND (r.last_sent_at IS NULL OR r.last_sent_at<unixepoch()-604800)`).all() as any[];for(const r of rows){const body=`Hello ${r.name}, a payment of ₹${Number(r.balance_due).toFixed(2)} is outstanding with Sarvani Suit and Saree. Please contact us for details.`;await queueAndTrySend({id:null,name:r.name,phone:r.phone},"PAYMENT_REMINDER",body);db.prepare("UPDATE payment_reminders SET last_sent_at=unixepoch() WHERE id=?").run(r.id)}}catch(e){console.error("[scheduler] reminder job",e)}});

  // Website stock queue processor. If no website credentials are configured, events remain safely queued.
  cron.schedule("*/5 * * * *",async()=>{try{const base=String(process.env.WEBSITE_BASE_URL||"").replace(/\/$/,"");if(!base)return;const db=sqliteConn!;const rows=db.prepare(`SELECT * FROM sync_queue WHERE status='PENDING' ORDER BY created_at LIMIT 50`).all() as any[];for(const q of rows){try{const product=db.prepare(`SELECT v.id variant_id,v.sku,p.name,v.selling_price,v.barcode,v.color,v.size,p.image_url,COALESCE((SELECT SUM(CASE WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity ELSE 0 END) FROM stock_ledger WHERE variant_id=v.id),0) stock FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(q.entity_id);const r=await fetch(base+"/api/inventory/sync",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.WEBSITE_API_TOKEN||""}`},body:JSON.stringify({source:"sarvani-pos",products:[product]})});if(!r.ok)throw new Error(`HTTP ${r.status}`);db.prepare(`UPDATE sync_queue SET status='DONE',processed_at=unixepoch() WHERE id=?`).run(q.id);db.prepare(`INSERT INTO website_sync_log(id,direction,entity_type,entity_id,status,message) VALUES(?,?,?,?,?,?)`).run(newId(),"OUT","STOCK",q.entity_id,"SUCCESS","Automatic stock sync") }catch(e:any){db.prepare(`UPDATE sync_queue SET attempts=attempts+1,last_error=? WHERE id=?`).run(String(e.message).slice(0,500),q.id)}}}catch(e){console.error("[scheduler] website sync",e)}});

  // Nightly local backup. This is a real copy, not a log-only placeholder.
  cron.schedule("30 23 * * *",()=>{try{const dbPath=path.resolve(process.env.SQLITE_PATH||"./dev.db");if(!fs.existsSync(dbPath))return;const dir=path.resolve(process.env.BACKUP_DIR||"./backups");fs.mkdirSync(dir,{recursive:true});const name=`sarvani-${new Date().toISOString().slice(0,10)}.db`;const target=path.join(dir,name);fs.copyFileSync(dbPath,target);sqliteConn!.prepare("INSERT INTO backup_log(id,file_path,created_at) VALUES(?,?,unixepoch())").run(newId(),target)}catch(e){console.error("[scheduler] backup job",e)}});
  console.log("[scheduler] background automation started: CRM, reminders, backups");
}
