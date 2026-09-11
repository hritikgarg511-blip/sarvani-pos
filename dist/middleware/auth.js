"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const auth_1 = require("../lib/auth");
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const token = header.slice("Bearer ".length);
    try {
        const payload = (0, auth_1.verifyToken)(token);
        req.user = payload;
        next();
    }
    catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user)
            return res.status(401).json({ error: "Not authenticated" });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Insufficient permissions for this action" });
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map