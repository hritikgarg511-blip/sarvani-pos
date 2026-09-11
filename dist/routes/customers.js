"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../db/client");
const drizzle_orm_1 = require("drizzle-orm");
const auth_1 = require("../middleware/auth");
const id_1 = require("../lib/id");
const audit_1 = require("../lib/audit");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get("/", async (req, res) => {
    const q = String(req.query.q || "").trim();
    let rows;
    if (q) {
        const like_ = `%${q}%`;
        rows = await client_1.db
            .select()
            .from(client_1.schema.customers)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(client_1.schema.customers.phone, like_), (0, drizzle_orm_1.like)(client_1.schema.customers.name, like_)))
            .orderBy((0, drizzle_orm_1.desc)(client_1.schema.customers.createdAt))
            .limit(25);
    }
    else {
        rows = await client_1.db.select().from(client_1.schema.customers).orderBy((0, drizzle_orm_1.desc)(client_1.schema.customers.createdAt)).limit(50);
    }
    res.json({ customers: rows });
});
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    phone: zod_1.z.string().min(5),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    addressLine: zod_1.z.string().optional(),
    city: zod_1.z.string().optional(),
    state: zod_1.z.string().optional(),
    stateCode: zod_1.z.string().optional(),
    gstin: zod_1.z.string().optional(),
    birthday: zod_1.z.string().optional(), // ISO date
    anniversary: zod_1.z.string().optional(),
    tags: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    whatsappOptIn: zod_1.z.boolean().optional(),
    membershipId: zod_1.z.string().optional(),
    creditLimit: zod_1.z.number().nonnegative().optional(),
});
router.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid customer data", details: parsed.error.flatten() });
    const d = parsed.data;
    const existing = await client_1.db.select().from(client_1.schema.customers).where((0, drizzle_orm_1.eq)(client_1.schema.customers.phone, d.phone)).limit(1);
    if (existing.length) {
        return res.status(409).json({ error: "A customer with this phone number already exists", customer: existing[0] });
    }
    const id = (0, id_1.newId)();
    await client_1.db.insert(client_1.schema.customers).values({
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
    await (0, audit_1.writeAudit)({ userId: req.user.userId, action: "CUSTOMER_CREATE", entity: "Customer", entityId: id, ipAddress: req.ip });
    const [row] = await client_1.db.select().from(client_1.schema.customers).where((0, drizzle_orm_1.eq)(client_1.schema.customers.id, id)).limit(1);
    res.status(201).json({ customer: row });
});
router.get("/:id", async (req, res) => {
    const [row] = await client_1.db.select().from(client_1.schema.customers).where((0, drizzle_orm_1.eq)(client_1.schema.customers.id, req.params.id)).limit(1);
    if (!row)
        return res.status(404).json({ error: "Customer not found" });
    const invoices = await client_1.db
        .select()
        .from(client_1.schema.invoices)
        .where((0, drizzle_orm_1.eq)(client_1.schema.invoices.customerId, req.params.id))
        .orderBy((0, drizzle_orm_1.desc)(client_1.schema.invoices.createdAt))
        .limit(50);
    res.json({ customer: row, invoices });
});
const updateSchema = createSchema.partial();
router.put("/:id", async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid customer data" });
    const d = parsed.data;
    const updates = { updatedAt: new Date() };
    for (const key of Object.keys(d)) {
        if (key === "birthday" || key === "anniversary") {
            updates[key] = d[key] ? new Date(d[key]) : null;
        }
        else if (d[key] !== undefined) {
            updates[key] = d[key];
        }
    }
    await client_1.db.update(client_1.schema.customers).set(updates).where((0, drizzle_orm_1.eq)(client_1.schema.customers.id, req.params.id));
    await (0, audit_1.writeAudit)({ userId: req.user.userId, action: "CUSTOMER_UPDATE", entity: "Customer", entityId: req.params.id, ipAddress: req.ip });
    const [row] = await client_1.db.select().from(client_1.schema.customers).where((0, drizzle_orm_1.eq)(client_1.schema.customers.id, req.params.id)).limit(1);
    res.json({ customer: row });
});
exports.default = router;
//# sourceMappingURL=customers.js.map