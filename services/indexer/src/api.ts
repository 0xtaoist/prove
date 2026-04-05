import { Router, Request, Response } from "express";
import { prisma } from "./db";
import { serializeBigInts, isValidSolanaAddress, errorResponse } from "@prove/common";

const router = Router();

function json(res: Response, data: unknown, status = 200): void {
  res.status(status).json(serializeBigInts(data));
}

/** Validate a :mint or :wallet route param as a Solana address. Returns the address or null (after sending 400). */
function requireSolanaAddress(req: Request, res: Response, param: string): string | null {
  const value = req.params[param];
  if (!value || !isValidSolanaAddress(value)) {
    res.status(400).json(errorResponse(`Invalid Solana address for parameter '${param}'`));
    return null;
  }
  return value;
}

// ─── GET /api/feed ──────────────────────────────────────────
router.get("/api/feed", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get tokens that are actively trading
    const auctions = await prisma.auction.findMany({
      where: {
        state: "TRADING",
        participantCount: { gt: 20 },
      },
      include: {
        quests: { where: { completed: true } },
        _count: { select: { swaps: true } },
      },
    });

    // For each auction, compute ranking metrics
    const feed = await Promise.all(
      auctions.map(async (auction) => {
        const holderCount = await prisma.holderSnapshot.count({
          where: { mint: auction.mint, balance: { gt: 0 } },
        });

        const lastTrade = await prisma.swap.findFirst({
          where: { auctionMint: auction.mint },
          orderBy: { timestamp: "desc" },
          select: { timestamp: true },
        });

        // Skip if no trade in last 24h
        if (!lastTrade || lastTrade.timestamp < twentyFourHoursAgo) return null;

        // Volume in last 24h
        const recentSwaps = await prisma.swap.aggregate({
          where: {
            auctionMint: auction.mint,
            timestamp: { gte: twentyFourHoursAgo },
          },
          _sum: { solAmount: true },
        });
        const volume24h = Number(recentSwaps._sum.solAmount ?? 0);

        // Average hold time from holder snapshots
        const holders = await prisma.holderSnapshot.findMany({
          where: { mint: auction.mint, balance: { gt: 0 } },
          select: { firstSeen: true },
        });
        const now = Date.now();
        const avgHoldTime =
          holders.length > 0
            ? holders.reduce((sum, h) => sum + (now - h.firstSeen.getTime()), 0) /
              holders.length /
              (60 * 60 * 1000) // hours
            : 0;

        const questCount = auction.quests.length;

        // Ranking score
        const rank =
          0.4 * holderCount +
          0.3 * (volume24h / 1e9) + // normalize SOL lamports
          0.2 * avgHoldTime +
          0.1 * questCount;

        return {
          mint: auction.mint,
          ticker: auction.ticker,
          tokenName: auction.tokenName,
          tokenImage: auction.tokenImage,
          holderCount,
          volume24h,
          avgHoldTime: Math.round(avgHoldTime * 100) / 100,
          questsCompleted: questCount,
          lastTrade: lastTrade.timestamp,
          rank,
        };
      })
    );

    const filtered = feed
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => b.rank - a.rank)
      .slice(offset, offset + limit);

    json(res, { tokens: filtered, total: filtered.length });
  } catch (err) {
    console.error("[api] GET /api/feed error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/auction/:mint ─────────────────────────────────
router.get("/api/auction/:mint", async (req: Request, res: Response) => {
  try {
    const mint = requireSolanaAddress(req, res, "mint");
    if (!mint) return;

    const auction = await prisma.auction.findUnique({
      where: { mint },
      include: {
        commitments: { orderBy: { createdAt: "desc" } },
        stake: true,
        quests: true,
      },
    });

    if (!auction) {
      res.status(404).json(errorResponse("Auction not found"));
      return;
    }

    json(res, auction);
  } catch (err) {
    console.error("[api] GET /api/auction/:mint error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/auctions/active ───────────────────────────────
router.get("/api/auctions/active", async (_req: Request, res: Response) => {
  try {
    const auctions = await prisma.auction.findMany({
      where: { state: "GATHERING" },
      include: { stake: true, _count: { select: { commitments: true } } },
      orderBy: { endTime: "asc" },
    });

    json(res, auctions);
  } catch (err) {
    console.error("[api] GET /api/auctions/active error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/token/:mint ───────────────────────────────────
router.get("/api/token/:mint", async (req: Request, res: Response) => {
  try {
    const mint = requireSolanaAddress(req, res, "mint");
    if (!mint) return;

    const auction = await prisma.auction.findUnique({
      where: { mint },
      include: { quests: true, stake: true },
    });

    if (!auction) {
      res.status(404).json(errorResponse("Token not found"));
      return;
    }

    const holderCount = await prisma.holderSnapshot.count({
      where: { mint, balance: { gt: 0 } },
    });

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const volume24h = await prisma.swap.aggregate({
      where: { auctionMint: mint, timestamp: { gte: twentyFourHoursAgo } },
      _sum: { solAmount: true },
    });

    const latestSwap = await prisma.swap.findFirst({
      where: { auctionMint: mint },
      orderBy: { timestamp: "desc" },
      select: { price: true, timestamp: true },
    });

    json(res, {
      mint: auction.mint,
      ticker: auction.ticker,
      tokenName: auction.tokenName,
      tokenImage: auction.tokenImage,
      description: auction.description,
      creator: auction.creator,
      state: auction.state,
      totalSupply: auction.totalSupply,
      holderCount,
      volume24h: volume24h._sum.solAmount ?? BigInt(0),
      currentPrice: latestSwap?.price ?? null,
      lastTradeAt: latestSwap?.timestamp ?? null,
      quests: auction.quests,
      stake: auction.stake,
    });
  } catch (err) {
    console.error("[api] GET /api/token/:mint error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/profile/:wallet ───────────────────────────────
router.get("/api/profile/:wallet", async (req: Request, res: Response) => {
  try {
    const wallet = requireSolanaAddress(req, res, "wallet");
    if (!wallet) return;

    const [proveScore, commitments, holdings, recentSwaps] = await Promise.all([
      prisma.proveScore.findUnique({ where: { wallet } }),
      prisma.commitment.findMany({
        where: { wallet },
        include: { auction: { select: { ticker: true, state: true, mint: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.holderSnapshot.findMany({
        where: { wallet, balance: { gt: 0 } },
      }),
      prisma.swap.findMany({
        where: { wallet },
        orderBy: { timestamp: "desc" },
        take: 50,
      }),
    ]);

    json(res, {
      wallet,
      proveScore: proveScore ?? { score: 0, wallet },
      commitments,
      holdings,
      recentSwaps,
    });
  } catch (err) {
    console.error("[api] GET /api/profile/:wallet error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/creator/:wallet ───────────────────────────────
router.get("/api/creator/:wallet", async (req: Request, res: Response) => {
  try {
    const wallet = requireSolanaAddress(req, res, "wallet");
    if (!wallet) return;

    const [tokens, fees, stakes] = await Promise.all([
      prisma.auction.findMany({
        where: { creator: wallet },
        include: { _count: { select: { commitments: true, swaps: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.creatorFee.findMany({ where: { creator: wallet } }),
      prisma.stake.findMany({ where: { creator: wallet } }),
    ]);

    const totalEarned = fees.reduce((sum, f) => sum + f.totalEarned, BigInt(0));
    const totalWithdrawn = fees.reduce((sum, f) => sum + f.totalWithdrawn, BigInt(0));

    json(res, {
      wallet,
      tokens,
      fees: {
        breakdown: fees,
        totalEarned,
        totalWithdrawn,
        available: totalEarned - totalWithdrawn,
      },
      stakes,
    });
  } catch (err) {
    console.error("[api] GET /api/creator/:wallet error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/quests/:mint ──────────────────────────────────
router.get("/api/quests/:mint", async (req: Request, res: Response) => {
  try {
    const mint = requireSolanaAddress(req, res, "mint");
    if (!mint) return;

    const quests = await prisma.quest.findMany({
      where: { auctionMint: mint },
      orderBy: { createdAt: "asc" },
    });

    json(res, quests);
  } catch (err) {
    console.error("[api] GET /api/quests/:mint error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

export default router;
