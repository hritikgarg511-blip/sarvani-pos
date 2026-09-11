"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
function notFoundHandler(req, res) {
    res.status(404).json({ error: `No route: ${req.method} ${req.path}` });
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err, req, res, next) {
    console.error("Unhandled error:", err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || "Internal server error" });
}
//# sourceMappingURL=errors.js.map