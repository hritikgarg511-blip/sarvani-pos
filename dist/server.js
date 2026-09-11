"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = __importDefault(require("./routes/auth"));
const pos_1 = __importDefault(require("./routes/pos"));
const customers_1 = __importDefault(require("./routes/customers"));
const inventory_1 = __importDefault(require("./routes/inventory"));
const reports_1 = __importDefault(require("./routes/reports"));
const management_1 = __importDefault(require("./routes/management"));
const errors_1 = require("./middleware/errors");
const scheduler_1 = require("./jobs/scheduler");
const websiteApi_1 = __importDefault(require("./routes/websiteApi"));
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 4000;
app.use((0, helmet_1.default)({ contentSecurityPolicy: false })); // CSP relaxed for the bundled vanilla-JS frontend; tighten in production behind a real domain
app.use((0, cors_1.default)());
app.use((0, compression_1.default)());
app.use(express_1.default.json({ limit: "2mb" }));
app.use((0, morgan_1.default)("dev"));
const apiLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, limit: 300 });
app.use("/api", apiLimiter);
app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString(), service: "sarvani-pos" }));
app.use("/api/public/website", websiteApi_1.default);
app.use("/api/auth", auth_1.default);
app.use("/api/pos", pos_1.default);
app.use("/api/customers", customers_1.default);
app.use("/api/inventory", inventory_1.default);
app.use("/api/reports", reports_1.default);
app.use("/api/management", management_1.default);
// Serve the plain HTML/CSS/JS frontend
const frontendDir = path_1.default.join(__dirname, "..", "..", "frontend");
app.use(express_1.default.static(frontendDir));
app.use("/uploads", express_1.default.static(path_1.default.resolve(__dirname, "../public/uploads")));
app.get("/", (_req, res) => res.sendFile(path_1.default.join(frontendDir, "pages", "login.html")));
app.use("/api", errors_1.notFoundHandler);
app.use(errors_1.errorHandler);
app.listen(PORT, () => {
    console.log(`Sarvani POS backend running on http://localhost:${PORT}`);
    (0, scheduler_1.startScheduler)();
});
//# sourceMappingURL=server.js.map