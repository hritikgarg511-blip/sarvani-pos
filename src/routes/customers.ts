import { Router } from "express";
import { z } from "zod";
import { db, schema } from "../db/client";
import { eq, like, or, desc } from "drizzle-orm";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { newId } from "../lib/id";
import { writeAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

router.get("/", async (req: AuthedRequest, res) => {
  const q = String(req.query.q || "").trim();
  let rows;
  if (q) {
    const like_ = `%${q}%`;
    rows = await db
      .select()
      .from(schema.customers)
      .where(or(like(schema.customers.phone, like_), like(schema.customers.name, like_)))
      .orderBy(desc(schema.customers.createdAt))
      .limit(25);
  } else {
    rows = await db.select().from(schema.customers).orderBy(desc(schema.customers.createdAt)).limit(50);
  }
  res.json({ customers: rows });
});

const createSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional().or(z.literal("")),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  stateCode: z.string().optional(),
  gstin: z.string().optional(),
  birthday: z.string().optional(), // ISO date
  anniversary: z.string().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
  whatsappOptIn: z.boolean().optional(),
  membershipId: z.string().optional(),
  creditLimit: z.number().nonnegative().optional(),
});

router.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid customer data", details: parsed.error.flatten() });
  const d = parsed.data;

  const existing = await db.select().from(schema.customers).where(eq(schema.customers.phone, d.phone)).limit(1);
  if (existing.length) {
    return res.status(409).json({ error: "A customer with this phone number already exists", customer: existing[0] });
  }

  const id = newId();
  await db.insert(schema.customers).values({
    id,
    name: d.name,
    phone: d.phone,
    email: d.email || null,
    addressLine: d.addressLine || null,
    city: d.city || null,
    state: d.state || null,
    stateCode: d.stateCode || null,
    gstin: d.gstin || null,
    birthday: d.birthday ? new Date(d.birthday) : null,
    anniversary: d.anniversary ? new Date(d.anniversary) : null,
    tags: d.tags || null,
    notes: d.notes || null,
    whatsappOptIn: d.whatsappOptIn ?? true,
    membershipId: d.membershipId || null,
    creditLimit: d.creditLimit ?? 0,
  });

  await writeAudit({ userId: req.user!.userId, action: "CUSTOMER_CREATE", entity: "Customer", entityId: id, ipAddress: req.ip });

  const [row] = await db.select().from(schema.customers).where(eq(schema.customers.id, id)).limit(1);
  res.status(201).json({ customer: row });
});

router.get("/:id", async (req: AuthedRequest, res) => {
  const [row] = await db.select().from(schema.customers).where(eq(schema.customers.id, req.params.id)).limit(1);
  if (!row) return res.status(404).json({ error: "Customer not found" });

  const invoices = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.customerId, req.params.id))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(50);

  res.json({ customer: row, invoices });
});

const updateSchema = createSchema.partial();

router.put("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid customer data" });
  const d = parsed.data;

  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const key of Object.keys(d) as (keyof typeof d)[]) {
    if (key === "birthday" || key === "anniversary") {
      updates[key] = d[key] ? new Date(d[key] as string) : null;
    } else if (d[key] !== undefined) {
      updates[key] = d[key];
    }
  }

  await db.update(schema.customers).set(updates).where(eq(schema.customers.id, req.params.id));
  await writeAudit({ userId: req.user!.userId, action: "CUSTOMER_UPDATE", entity: "Customer", entityId: req.params.id, ipAddress: req.ip });

  const [row] = await db.select().from(schema.customers).where(eq(schema.customers.id, req.params.id)).limit(1);
  res.json({ customer: row });
});

export default router;
