import { Router } from "express";
import { z } from "zod";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { verifyPassword, signToken } from "../lib/auth";
import { writeAudit } from "../lib/audit";

const router = Router();

const loginSchema = z.object({
  phone: z.string().min(5),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "phone and password are required" });
  }
  const { phone, password } = parsed.data;

  const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await writeAudit({ action: "LOGIN_FAILED", entity: "User", entityId: user.id, ipAddress: req.ip });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({ userId: user.id, role: user.role, name: user.name });
  await writeAudit({ userId: user.id, action: "LOGIN_SUCCESS", entity: "User", entityId: user.id, ipAddress: req.ip });

  res.json({
    token,
    user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
  });
});

export default router;
