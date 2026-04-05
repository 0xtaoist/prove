import express from "express";
import cors from "cors";
import apiRouter from "./api";
import { startVerificationLoop } from "./verifier";
import { prisma } from "./db";

const app = express();
const PORT = parseInt(process.env.QUEST_PORT || process.env.PORT || "4001", 10);

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// TODO: Add rate limiting middleware here (e.g. express-rate-limit) before production deployment
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
