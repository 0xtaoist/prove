import express from "express";
import cors from "cors";
import apiRouter from "./api";
import { startListener, stopListener } from "./listener";
import { startScoreCalculator } from "./score";
import { prisma } from "./db";

const app = express();
const PORT = parseInt(process.env.INDEXER_PORT || process.env.PORT || "4000", 10);

// CORS
app.use(
  cors({
    origin: process.env.APP_ORIGIN || "*",
    methods: ["GET"],
  })
);

app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// TODO: Add rate limiting middleware here (e.g. express-rate-limit) before production deployment
// API routes
app.use(apiRouter);

// Start server
const server = app.listen(PORT, () => {
  console.log(`[indexer] Server listening on port ${PORT}`);

  // Start Solana log listener
  startListener();

  // Start hourly score calculator
  scoreTimer = startScoreCalculator();
});

let scoreTimer: NodeJS.Timeout | undefined;

// ─── Graceful shutdown (Railway sends SIGTERM on deploy) ────
async function shutdown(signal: string): Promise<void> {
  console.log(`[indexer] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("[indexer] HTTP server closed");
  });

  // Stop background tasks
  if (scoreTimer) clearInterval(scoreTimer);
  stopListener();

  // Close database connection
  await prisma.$disconnect();
  console.log("[indexer] Database disconnected");

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
