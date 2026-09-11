import { Router } from "express";
import { z } from "zod";
import { sqliteConn } from "../db/client";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { newId } from "../lib/id";
import { writeAudit } from "../lib/audit";
import fs from "fs";
import path from "path";

const router = Router();
router.use(requireAuth);

function stockSql(alias = "v") {
  return `(SELECT COALESCE(SUM(CASE WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity ELSE 0 END),0) FROM stock_ledger WHERE variant_id = ${alias}.id)`;
}


// Real image upload: accepts a data URL from the admin UI and stores it under the POS static assets.
router.post("/upload-image", async (req: AuthedRequest, res) => {
  try {
    const data = String(req.body?.data || "");
    const match = data.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
    if (!match) return res.status(400).json({ error: "Valid PNG/JPEG/WEBP image data is required" });
    const buf = Buffer.from(match[2], "base64");
    if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ error: "Image must be 5 MB or smaller" });
    const ext = match[1].split("/")[1].replace("jpeg", "jpg");
    const dir = path.resolve(__dirname, "../../public/uploads");
    fs.mkdirSync(dir, { recursive: true });
    const file = `${newId()}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buf);
    const url = `/uploads/${file}`;
    await writeAudit({userId:req.user!.userId,action:"IMAGE_UPLOAD",entity:"ProductImage",entityId:file,ipAddress:req.ip});
    res.status(201).json({ ok:true, url });
  } catch (e:any) { res.status(400).json({ error:e.message || "Image upload failed" }); }
});

router.get("/categories", (_req, res) => {
  const rows = sqliteConn!.prepare(`SELECT id,name,hsn_code,gst_rate FROM categories ORDER BY name`).all();
  res.json({ categories: rows });
});

router.get("/products", (req, res) => {
  const q = String(req.query.q || "").trim();
  const categoryId = String(req.query.categoryId || "").trim();
  const sql = `
    SELECT p.id,p.name,p.brand,p.description,p.image_url,p.active,p.category_id,
           c.name category_name,c.hsn_code category_hsn,c.gst_rate category_gst,
           v.id variant_id,v.sku,v.barcode,v.color,v.size,v.fabric,v.purchase_rate,v.selling_price,v.mrp,v.gst_type,v.expiry_date,v.image_url variant_image_url,v.min_stock_level,v.active variant_active,
           ${stockSql("v")} current_stock
    FROM products p JOIN categories c ON c.id=p.category_id
    LEFT JOIN product_variants v ON v.product_id=p.id
    WHERE (?='' OR p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
      AND (?='' OR p.category_id=?)
    ORDER BY p.created_at DESC,p.name,v.sku`;
  const like = `%${q}%`;
  const rows = sqliteConn!.prepare(sql).all(q, like, like, like, categoryId, categoryId);
  res.json({ products: rows });
});

const productSchema = z.object({
  name: z.string().min(1), categoryId: z.string().min(1), hsnCode: z.string().optional(), gstRate: z.number().min(0).max(100).optional(),
  brand: z.string().optional(), description: z.string().optional(), imageUrl: z.string().optional(),
  sku: z.string().min(1), barcode: z.string().optional(), color: z.string().optional(), size: z.string().optional(), fabric: z.string().optional(),
  purchaseRate: z.number().min(0).default(0), sellingPrice: z.number().min(0), mrp: z.number().min(0).optional(), gstType: z.string().default("GST"), expiryDate: z.string().optional(), minStockLevel: z.number().int().min(0).default(2), openingStock: z.number().int().min(0).default(0),
});

router.post("/products", async (req: AuthedRequest, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product data", details: parsed.error.flatten() });
  const d = parsed.data;
  try {
    const result = sqliteConn!.transaction(() => {
      const productId = newId();
      const variantId = newId();
      sqliteConn!.prepare(`INSERT INTO products (id,name,category_id,hsn_code,gst_rate,brand,description,image_url,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,unixepoch(),unixepoch())`)
        .run(productId,d.name,d.categoryId,d.hsnCode||null,d.gstRate??null,d.brand||null,d.description||null,d.imageUrl||null);
      sqliteConn!.prepare(`INSERT INTO product_variants (id,product_id,sku,barcode,color,size,fabric,purchase_rate,selling_price,mrp,gst_type,expiry_date,min_stock_level,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,unixepoch(),unixepoch())`)
        .run(variantId,productId,d.sku,d.barcode||null,d.color||null,d.size||null,d.fabric||null,d.purchaseRate,d.sellingPrice,d.mrp??null,d.gstType,d.expiryDate?Math.floor(new Date(d.expiryDate).getTime()/1000):null,d.minStockLevel);
      if (d.openingStock > 0) {
        sqliteConn!.prepare(`INSERT INTO stock_ledger (id,variant_id,type,quantity,balance_after,ref_type,ref_id,note,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`)
          .run(newId(),variantId,"OPENING_STOCK",d.openingStock,d.openingStock,"PRODUCT",productId,"Opening stock",req.user!.userId);
      }
      return { productId, variantId };
    })();
    await writeAudit({userId:req.user!.userId,action:"PRODUCT_CREATE",entity:"Product",entityId:result.productId,ipAddress:req.ip});
    res.status(201).json({ ok:true,...result });
  } catch (err:any) { res.status(400).json({ error: err.message || "Could not create product" }); }
});

const updateSchema = z.object({ name:z.string().min(1).optional(),categoryId:z.string().min(1).optional(),hsnCode:z.string().nullable().optional(),gstRate:z.number().min(0).max(100).nullable().optional(),brand:z.string().nullable().optional(),description:z.string().nullable().optional(),imageUrl:z.string().nullable().optional(),active:z.boolean().optional(),sellingPrice:z.number().min(0).optional(),purchaseRate:z.number().min(0).optional(),mrp:z.number().min(0).nullable().optional(),gstType:z.string().optional(),expiryDate:z.string().nullable().optional(),minStockLevel:z.number().int().min(0).optional(),barcode:z.string().nullable().optional(),color:z.string().nullable().optional(),size:z.string().nullable().optional(),fabric:z.string().nullable().optional()});
router.put("/variants/:id", async (req: AuthedRequest,res)=>{
  const d=updateSchema.safeParse(req.body); if(!d.success)return res.status(400).json({error:"Invalid update"});
  const v=sqliteConn!.prepare(`SELECT * FROM product_variants WHERE id=?`).get(req.params.id) as any; if(!v)return res.status(404).json({error:"Variant not found"});
  const pFields:any={}; const vFields:any={};
  for(const [k,val] of Object.entries(d.data)) { if(val===undefined)continue; if(["name","categoryId","hsnCode","gstRate","brand","description","imageUrl"].includes(k)) pFields[k.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`)]=val; else vFields[k.replace(/[A-Z]/g,m=>`_${m.toLowerCase()}`)]=val; }
  sqliteConn!.transaction(()=>{
    if(Object.keys(pFields).length){pFields.updated_at=Math.floor(Date.now()/1000);const sets=Object.keys(pFields).map(k=>`${k}=?`).join(",");sqliteConn!.prepare(`UPDATE products SET ${sets} WHERE id=?`).run(...Object.values(pFields),v.product_id);}
    if(Object.keys(vFields).length){vFields.updated_at=Math.floor(Date.now()/1000);const sets=Object.keys(vFields).map(k=>`${k}=?`).join(",");sqliteConn!.prepare(`UPDATE product_variants SET ${sets} WHERE id=?`).run(...Object.values(vFields),req.params.id);}
  })();
  await writeAudit({userId:req.user!.userId,action:"PRODUCT_UPDATE",entity:"ProductVariant",entityId:req.params.id,ipAddress:req.ip});
  res.json({ok:true});
});

const adjustSchema=z.object({variantId:z.string(),type:z.enum(["ADJUSTMENT_IN","ADJUSTMENT_OUT","OPENING_STOCK","PURCHASE_IN","PURCHASE_RETURN_OUT","SALE_RETURN_IN"]),quantity:z.number().int().positive(),note:z.string().optional()});
router.post("/stock-adjustments",async(req:AuthedRequest,res)=>{
  const d=adjustSchema.safeParse(req.body);if(!d.success)return res.status(400).json({error:"Invalid stock adjustment"});
  const v=sqliteConn!.prepare(`SELECT id,sku FROM product_variants WHERE id=?`).get(d.data.variantId) as any;if(!v)return res.status(404).json({error:"Variant not found"});
  try{const balance=sqliteConn!.transaction(()=>{const cur=(sqliteConn!.prepare(`SELECT COALESCE(SUM(CASE WHEN type IN ('PURCHASE_IN','SALE_RETURN_IN','ADJUSTMENT_IN','OPENING_STOCK') THEN quantity WHEN type IN ('SALE_OUT','PURCHASE_RETURN_OUT','ADJUSTMENT_OUT') THEN -quantity ELSE 0 END),0) stock FROM stock_ledger WHERE variant_id=?`).get(v.id) as any).stock;const inbound=["PURCHASE_IN","SALE_RETURN_IN","ADJUSTMENT_IN","OPENING_STOCK"].includes(d.data.type);const next=cur+(inbound?d.data.quantity:-d.data.quantity);if(next<0)throw new Error(`Stock cannot go below zero. Available: ${cur}`);sqliteConn!.prepare(`INSERT INTO stock_ledger (id,variant_id,type,quantity,balance_after,ref_type,ref_id,note,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,unixepoch())`).run(newId(),v.id,d.data.type,d.data.quantity,next,"MANUAL",newId(),d.data.note||null,req.user!.userId);return next;})();await writeAudit({userId:req.user!.userId,action:"STOCK_ADJUST",entity:"Variant",entityId:v.id,details:{type:d.data.type,quantity:d.data.quantity},ipAddress:req.ip});res.json({ok:true,balance});}catch(err:any){res.status(400).json({error:err.message});}
});

router.delete("/variants/:id", async (req: AuthedRequest, res) => {
  const v = sqliteConn!.prepare(`SELECT id,product_id FROM product_variants WHERE id=?`).get(req.params.id) as any;
  if (!v) return res.status(404).json({error:"Variant not found"});
  sqliteConn!.transaction(()=>{
    sqliteConn!.prepare(`UPDATE product_variants SET active=0, updated_at=unixepoch() WHERE id=?`).run(v.id);
    const active = (sqliteConn!.prepare(`SELECT COUNT(*) c FROM product_variants WHERE product_id=? AND active=1`).get(v.product_id) as any).c;
    if (!active) sqliteConn!.prepare(`UPDATE products SET active=0, updated_at=unixepoch() WHERE id=?`).run(v.product_id);
  })();
  await writeAudit({userId:req.user!.userId,action:"PRODUCT_ARCHIVE",entity:"ProductVariant",entityId:v.id,ipAddress:req.ip});
  res.json({ok:true});
});

router.get("/ledger/:variantId",(req,res)=>{const rows=sqliteConn!.prepare(`SELECT * FROM stock_ledger WHERE variant_id=? ORDER BY created_at DESC LIMIT 100`).all(req.params.variantId);res.json({ledger:rows});});

export default router;
