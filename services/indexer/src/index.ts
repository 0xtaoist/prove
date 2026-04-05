import express from "express";
import cors from "cors";
import apiRouter from "./api";
import { startListener } from "./listener";
import { startScoreCalculator } from "./score";

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

// API routes
app.use(apiRouter);

// Start server
app.listen(PORT, () => {
  console.log(`[indexer] Server listening on port ${PORT}`);

  // Start Solana log listener
  startListener();

  // Start hourly score calculator
  startScoreCalculator();
});
