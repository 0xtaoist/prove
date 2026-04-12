import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import apiRouter from "./api";
import { startVerificationLoop } from "./verifier";
import { prisma } from "./db";

const app = express();
const PORT = parseInt(process.env.QUEST_PORT || process.env.PORT || "4001", 10);

// CORS — require APP_ORIGIN in production
const allowedOrigin = process.env.APP_ORIGIN;
if (!allowedOrigin) {
  console.warn("[quest-verifier] APP_ORIGIN not set — CORS will reject cross-origin requests in production");
}
app.use(
  cors({
    origin: allowedOrigin || false,
    methods: ["GET", "POST"],
  })
);
// Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

// Health check (exempt from rate limiting)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — try again shortly" },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many write requests — try again shortly" },
});
app.use("/api", (req, _res, next) => {
  if (req.method === "POST") return writeLimiter(req, _res, next);
  return apiLimiter(req, _res, next);
});

// Quest API routes
app.use(apiRouter);

let verificationTimer: NodeJS.Timeout | undefined;

const server = app.listen(PORT, () => {
  console.log(`[quest-verifier] Listening on port ${PORT}`);
  verificationTimer = startVerificationLoop();
});

// ─── Graceful shutdown (Railway sends SIGTERM on deploy) ────
async function shutdown(signal: string): Promise<void> {
  console.log(`[quest-verifier] Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log("[quest-verifier] HTTP server closed");
  });

  if (verificationTimer) clearInterval(verificationTimer);

  await prisma.$disconnect();
  console.log("[quest-verifier] Database disconnected");

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
