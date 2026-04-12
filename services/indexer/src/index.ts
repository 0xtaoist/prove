import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { type Options as RateLimitOptions } from "express-rate-limit";
import apiRouter from "./api";
import { startListener, stopListener } from "./listener";
import { startScoreCalculator } from "./score";
import { startFeeCollector } from "./fee-collector";
import { startSwapIndexer, stopSwapIndexer } from "./swap-indexer";
import { prisma } from "./db";
import { assertProtocolConfig } from "./protocol-config";
import { createRateLimitStore } from "./rate-limit-store";

const app = express();
const PORT = parseInt(process.env.INDEXER_PORT || process.env.PORT || "4000", 10);

// CORS — reject cross-origin requests unless APP_ORIGIN is explicitly set
const allowedOrigin = process.env.APP_ORIGIN;
if (!allowedOrigin) {
  console.warn("[indexer] APP_ORIGIN not set — CORS will reject cross-origin requests in production");
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

// Rate limiting — uses Redis when REDIS_URL is set (distributed across
// Railway replicas), otherwise falls back to in-memory.
const storeOpts: Partial<RateLimitOptions> = {};
const store = createRateLimitStore();
if (store) storeOpts.store = store;

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — try again shortly" },
  ...storeOpts,
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many write requests — try again shortly" },
  ...storeOpts,
});
app.use("/api", (req, _res, next) => {
  if (req.method === "POST") return writeLimiter(req, _res, next);
  return readLimiter(req, _res, next);
});

// API routes
app.use(apiRouter);

// Start server
const server = app.listen(PORT, async () => {
  console.log(`[indexer] Server listening on port ${PORT}`);

  // Load-bearing invariant: the ProtocolConfig row must exist and pin the
  // 80/20 split + protocol vault address before we'll process any fees.
  try {
    const cfg = await assertProtocolConfig();
    console.log(
      `[indexer] ProtocolConfig OK: ${cfg.creatorBps}/${cfg.protocolBps} split, vault=${cfg.protocolVaultAddress}`,
    );
  } catch (err) {
    console.error("[indexer] FATAL: ProtocolConfig assertion failed:", err);
    process.exit(1);
  }

  // Start Solana log listener
  startListener();

  // Start hourly score calculator
  scoreTimer = startScoreCalculator();

  // Start fee collection crank (every 15 minutes)
  feeTimer = startFeeCollector();

  // Start swap indexer (polls Raydium/Jupiter every 30s)
  swapTimer = startSwapIndexer();
});

let scoreTimer: NodeJS.Timeout | undefined;
let feeTimer: NodeJS.Timeout | undefined;
let swapTimer: NodeJS.Timeout | undefined;

// ─── Graceful shutdown (Railway sends SIGTERM on deploy) ────
async function shutdown(signal: string): Promise<void> {
  console.log(`[indexer] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("[indexer] HTTP server closed");
  });

  // Stop background tasks
  if (scoreTimer) clearInterval(scoreTimer);
  if (feeTimer) clearInterval(feeTimer);
  if (swapTimer) clearInterval(swapTimer);
  stopSwapIndexer();
  stopListener();

  // Close database connection
  await prisma.$disconnect();
  console.log("[indexer] Database disconnected");

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
