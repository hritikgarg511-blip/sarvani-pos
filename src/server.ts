import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import path from "path";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth";
import posRoutes from "./routes/pos";
import customerRoutes from "./routes/customers";
import inventoryRoutes from "./routes/inventory";
import reportsRoutes from "./routes/reports";
import managementRoutes from "./routes/management";
import { notFoundHandler, errorHandler } from "./middleware/errors";
import { startScheduler } from "./jobs/scheduler";
import websiteApiRoutes from "./routes/websiteApi";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for the bundled vanilla-JS frontend; tighten in production behind a real domain
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300 });
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString(), service:"sarvani-pos" }));
app.use("/api/public/website", websiteApiRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/management", managementRoutes);

// Serve the plain HTML/CSS/JS frontend
const frontendDir = path.join(__dirname, "..", "..", "frontend");
app.use(express.static(frontendDir));
app.use("/uploads", express.static(path.resolve(__dirname, "../public/uploads")));
app.get("/", (_req, res) => res.sendFile(path.join(frontendDir, "pages", "login.html")));

app.use("/api", notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Sarvani POS backend running on http://localhost:${PORT}`);
  startScheduler();
});
