import { Router, Request, Response } from "express";
import { prisma } from "./db";
import {
  serializeBigInts,
  isValidSolanaAddress,
  errorResponse,
  FEED_WEIGHT_HOLDERS,
  FEED_WEIGHT_VOLUME_24H,
  FEED_WEIGHT_HOLD_TIME,
  FEED_WEIGHT_QUESTS,
} from "@prove/common";
import { requirePrivyAuth, AuthenticatedRequest } from "./auth";

const router: ReturnType<typeof Router> = Router();

function json(res: Response, data: unknown, status = 200): void {
  res.status(status).json(serializeBigInts(data));
}

/** Validate a :mint or :wallet route param as a Solana address. Returns the address or null (after sending 400). */
function requireSolanaAddress(req: Request, res: Response, param: string): string | null {
  const raw = req.params[param];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !isValidSolanaAddress(value)) {
    res.status(400).json(errorResponse(`Invalid Solana address for parameter '${param}'`));
    return null;
  }
  return value;
}

// ─── GET /api/feed ──────────────────────────────────────────

interface FeedEntry {
  mint: string;
  ticker: string;
  tokenName: string | null;
  tokenImage: string | null;
  holderCount: number;
  volume24h: number;
  avgHoldTime: number;
  questsCompleted: number;
  lastTrade: Date;
  rank: number;
}

async function computeFeedEntry(
  auction: { mint: string; ticker: string; tokenName: string | null; tokenImage: string | null; quests: { id: string }[] },
  cutoff: Date,
): Promise<FeedEntry | null> {
  const holderCount = await prisma.holderSnapshot.count({
    where: { mint: auction.mint, balance: { gt: 0 } },
  });

  const lastTrade = await prisma.swap.findFirst({
    where: { auctionMint: auction.mint },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });

  if (!lastTrade || lastTrade.timestamp < cutoff) return null;

  const recentSwaps = await prisma.swap.aggregate({
    where: { auctionMint: auction.mint, timestamp: { gte: cutoff } },
    _sum: { solAmount: true },
  });
  const volume24h = Number(recentSwaps._sum.solAmount ?? 0);

  const holders = await prisma.holderSnapshot.findMany({
    where: { mint: auction.mint, balance: { gt: 0 } },
    select: { firstSeen: true },
  });
  const now = Date.now();
  const avgHoldTime =
    holders.length > 0
      ? holders.reduce((sum, h) => sum + (now - h.firstSeen.getTime()), 0) /
        holders.length /
        (60 * 60 * 1000)
      : 0;

  const questCount = auction.quests.length;

  const rank =
    FEED_WEIGHT_HOLDERS * holderCount +
    FEED_WEIGHT_VOLUME_24H * (volume24h / 1e9) +
    FEED_WEIGHT_HOLD_TIME * avgHoldTime +
    FEED_WEIGHT_QUESTS * questCount;

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
}

router.get("/api/feed", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 50, 100));
    const offset = Math.max(0, Math.min(parseInt(req.query.offset as string) || 0, 10_000));
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Only load auctions that have had recent swap activity (DB-level filter).
    // This avoids loading every TRADING auction into memory when most are stale.
    const recentMints = await prisma.swap.findMany({
      where: { timestamp: { gte: cutoff } },
      select: { auctionMint: true },
      distinct: ["auctionMint"],
    });
    const mintSet = new Set(recentMints.map((s) => s.auctionMint));

    const auctions = await prisma.auction.findMany({
      where: {
        state: "TRADING",
        participantCount: { gt: 20 },
        mint: { in: Array.from(mintSet) },
      },
      include: {
        quests: { where: { completed: true }, select: { id: true } },
      },
    });

    const entries = await Promise.all(
      auctions.map((a) => computeFeedEntry(a, cutoff)),
    );

    const ranked = entries
      .filter((t): t is FeedEntry => t !== null)
      .sort((a, b) => b.rank - a.rank);

    const page = ranked.slice(offset, offset + limit);

    json(res, { tokens: page, total: ranked.length });
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

// ─── POST /api/creators ─────────────────────────────────────
// Register (or update) the Creator row for a wallet, optionally linking a
// Privy user id. Called by the launch flow BEFORE the on-chain transaction
// lands so the Auction FK always resolves.
// Protected by Privy authentication when configured.
router.post("/api/creators", requirePrivyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as {
      wallet?: string;
      email?: string | null;
      handle?: string | null;
    };
    const wallet = body?.wallet;
    if (!wallet || !isValidSolanaAddress(wallet)) {
      res.status(400).json(errorResponse("Invalid or missing 'wallet'"));
      return;
    }

    // Use the verified Privy user ID from the auth token — never trust the
    // request body for identity. This prevents impersonation / IDOR attacks.
    const privyUserId = req.privyUserId ?? null;

    // Validate email format + length
    if (body.email != null) {
      if (
        typeof body.email !== "string" ||
        body.email.length > 254 ||
        body.email.length === 0 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
      ) {
        res.status(400).json(errorResponse("Invalid email address"));
        return;
      }
    }

    // Validate handle: alphanumeric + underscores, max 50 chars
    if (body.handle != null) {
      if (
        typeof body.handle !== "string" ||
        body.handle.length > 50 ||
        body.handle.length === 0 ||
        !/^[a-zA-Z0-9_]+$/.test(body.handle)
      ) {
        res.status(400).json(errorResponse("handle must be 1-50 alphanumeric/underscore characters"));
        return;
      }
    }

    // Prevent wallet hijacking: if another Creator row already has this
    // privyUserId linked to a *different* wallet, reject.
    if (privyUserId) {
      const existing = await prisma.creator.findFirst({
        where: { privyUserId, NOT: { wallet } },
      });
      if (existing) {
        res.status(409).json(errorResponse("This Privy account is already linked to a different wallet"));
        return;
      }
    }

    const creator = await prisma.creator.upsert({
      where: { wallet },
      create: {
        wallet,
        privyUserId,
        email: body.email ?? null,
        handle: body.handle ?? null,
      },
      update: {
        privyUserId: privyUserId ?? undefined,
        email: body.email ?? undefined,
        handle: body.handle ?? undefined,
      },
    });

    json(res, creator);
  } catch (err) {
    console.error("[api] POST /api/creators error:", err);
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
