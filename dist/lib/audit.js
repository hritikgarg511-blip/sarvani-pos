"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAudit = writeAudit;
const client_1 = require("../db/client");
const id_1 = require("./id");
async function writeAudit(params) {
    try {
        await client_1.db.insert(client_1.schema.auditLogs).values({
            id: (0, id_1.newId)(),
            userId: params.userId || null,
            action: params.action,
            entity: params.entity,
            entityId: params.entityId,
            details: params.details ? JSON.stringify(params.details) : null,
            ipAddress: params.ipAddress,
        });
    }
    catch (err) {
        // Audit logging must never break the primary business operation.
        // eslint-disable-next-line no-console
        console.error("Failed to write audit log:", err);
    }
}
//# sourceMappingURL=audit.js.map