import { db, schema } from "../db/client";
import { newId } from "./id";

export async function writeAudit(params: {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      id: newId(),
      userId: params.userId || null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      details: params.details ? JSON.stringify(params.details) : null,
      ipAddress: params.ipAddress,
    });
  } catch (err) {
    // Audit logging must never break the primary business operation.
    // eslint-disable-next-line no-console
    console.error("Failed to write audit log:", err);
  }
}
