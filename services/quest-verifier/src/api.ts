import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "./db";
import { initializeQuestsForAuction } from "./quest-init";
import { serializeBigInts, isValidSolanaAddress, errorResponse } from "@prove/common";

const router: ReturnType<typeof Router> = Router();

function json(res: Response, data: unknown, status = 200): void {
  res.status(status).json(serializeBigInts(data));
}

/**
 * Guard for internal service-to-service calls. Requires INTERNAL_API_KEY
 * env var to be set and matching the X-Internal-Key header. In dev mode
 * with explicit DISABLE_AUTH=true, the check is skipped.
 */
function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    if (process.env.DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production") {
      next();
      return;
    }
    res.status(503).json(errorResponse("Internal API key not configured"));
    return;
  }
  const provided = req.headers["x-internal-key"];
  if (provided !== expected) {
    res.status(401).json(errorResponse("Invalid or missing internal API key"));
    return;
  }
  next();
}

// POST /api/quests/init - Initialize quests for a new auction (internal only)
router.post("/api/quests/init", requireInternalAuth, async (req: Request, res: Response) => {
  try {
    const { mint, ticker } = req.body;

    if (!mint || !ticker) {
      res.status(400).json(errorResponse("mint and ticker are required"));
      return;
    }

    if (!isValidSolanaAddress(mint)) {
      res.status(400).json(errorResponse("Invalid Solana address for 'mint'"));
      return;
    }

    if (typeof ticker !== "string" || ticker.length === 0 || ticker.length > 10) {
      res.status(400).json(errorResponse("ticker must be a non-empty string (max 10 chars)"));
      return;
    }

    await initializeQuestsForAuction(mint, ticker);
    res.json({ success: true, mint });
  } catch (err) {
    console.error("[api] Error initializing quests:", err);
    res.status(500).json(errorResponse("Failed to initialize quests"));
  }
});

// GET /api/quests/:mint - Returns all quests for a token
router.get("/api/quests/:mint", async (req: Request, res: Response) => {
  try {
    const mint = req.params.mint as string;

    if (!isValidSolanaAddress(mint)) {
      res.status(400).json(errorResponse("Invalid Solana address for 'mint'"));
      return;
    }

    const quests = await prisma.quest.findMany({
      where: { auctionMint: mint },
      orderBy: { createdAt: "asc" },
    });

    json(res, quests);
  } catch (err) {
    console.error("[api] Error fetching quests:", err);
    res.status(500).json(errorResponse("Failed to fetch quests"));
  }
});

// GET /api/quests/:mint/badges - Returns list of earned badge strings
router.get("/api/quests/:mint/badges", async (req: Request, res: Response) => {
  try {
    const mint = req.params.mint as string;

    if (!isValidSolanaAddress(mint)) {
      res.status(400).json(errorResponse("Invalid Solana address for 'mint'"));
      return;
    }

    const completedQuests = await prisma.quest.findMany({
      where: {
        auctionMint: mint,
        completed: true,
      },
      select: { reward: true },
    });

    const badges = completedQuests.map((q) => q.reward);
    res.json(badges);
  } catch (err) {
    console.error("[api] Error fetching badges:", err);
    res.status(500).json(errorResponse("Failed to fetch badges"));
  }
});

export default router;
