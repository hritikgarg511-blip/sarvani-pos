"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../db/client");
const drizzle_orm_1 = require("drizzle-orm");
const auth_1 = require("../lib/auth");
const audit_1 = require("../lib/audit");
const router = (0, express_1.Router)();
const loginSchema = zod_1.z.object({
    phone: zod_1.z.string().min(5),
    password: zod_1.z.string().min(1),
});
router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "phone and password are required" });
    }
    const { phone, password } = parsed.data;
    const [user] = await client_1.db.select().from(client_1.schema.users).where((0, drizzle_orm_1.eq)(client_1.schema.users.phone, phone)).limit(1);
    if (!user || !user.active) {
        return res.status(401).json({ error: "Invalid credentials" });
    }
    const ok = await (0, auth_1.verifyPassword)(password, user.passwordHash);
    if (!ok) {
        await (0, audit_1.writeAudit)({ action: "LOGIN_FAILED", entity: "User", entityId: user.id, ipAddress: req.ip });
        return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = (0, auth_1.signToken)({ userId: user.id, role: user.role, name: user.name });
    await (0, audit_1.writeAudit)({ userId: user.id, action: "LOGIN_SUCCESS", entity: "User", entityId: user.id, ipAddress: req.ip });
    res.json({
        token,
        user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
    });
});
exports.default = router;
//# sourceMappingURL=auth.js.map