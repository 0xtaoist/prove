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

// ─── POST /api/metadata/upload ──────────────────────────────
// Upload token image + metadata before creating the on-chain auction.
// Stores image as base64 in the Auction row (created by the listener
// or pre-created here). Returns the metadata URI for on-chain use.
router.post("/api/metadata/upload", requirePrivyAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mint, name, description, image } = req.body as {
      mint?: string;
      name?: string;
      description?: string;
      image?: string; // base64-encoded image data with data URI prefix
    };

    if (!mint || !isValidSolanaAddress(mint)) {
      res.status(400).json(errorResponse("Invalid or missing 'mint'"));
      return;
    }
    if (!name || name.length > 50) {
      res.status(400).json(errorResponse("Invalid name"));
      return;
    }

    // Validate image size (max 500KB base64 ≈ 375KB binary)
    if (image && image.length > 700_000) {
      res.status(400).json(errorResponse("Image too large (max 500KB)"));
      return;
    }

    // Store metadata. The auction may not exist yet (created on-chain after
    // this call). Try to update if it exists, otherwise store in a lightweight
    // metadata cache that the listener will merge when the auction is created.
    const existing = await prisma.auction.findUnique({ where: { mint } });
    if (existing) {
      await prisma.auction.update({
        where: { mint },
        data: {
          tokenName: name,
          tokenImage: image ?? undefined,
          description: description ?? undefined,
        },
      });
    } else {
      // Store metadata in a temporary key-value style using a raw query
      // so we don't violate FK constraints. The listener will merge this
      // when the AuctionCreated event arrives.
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "TokenMetadataCache" (
          "mint" TEXT PRIMARY KEY,
          "name" TEXT,
          "image" TEXT,
          "description" TEXT,
          "createdAt" TIMESTAMP DEFAULT NOW()
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "TokenMetadataCache" ("mint", "name", "image", "description")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("mint") DO UPDATE SET "name" = $2, "image" = $3, "description" = $4
      `, mint, name, image ?? null, description ?? null);
    }

    const baseUrl = process.env.APP_ORIGIN ?? `http://localhost:${process.env.INDEXER_PORT ?? 4000}`;
    const metadataUri = `${baseUrl.replace('https://proveit.fun', 'https://proveindexer-production.up.railway.app')}/api/metadata/${mint}.json`;

    res.json({ ok: true, metadataUri });
  } catch (err) {
    console.error("[api] POST /api/metadata/upload error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/metadata/:mint.json ──────────────────────────
// Serves Metaplex-compatible JSON metadata for a token.
router.get("/api/metadata/:mintJson", async (req: Request, res: Response) => {
  try {
    const mintJson = req.params.mintJson as string;
    const mint = mintJson.replace(/\.json$/, "");
    if (!isValidSolanaAddress(mint)) {
      res.status(400).json(errorResponse("Invalid mint"));
      return;
    }

    let tokenData: { ticker?: string; tokenName?: string | null; tokenImage?: string | null; description?: string | null } | null;

    // Try auction table first, then metadata cache
    tokenData = await prisma.auction.findUnique({
      where: { mint },
      select: { ticker: true, tokenName: true, tokenImage: true, description: true },
    });

    if (!tokenData) {
      // Check cache table
      try {
        const cached = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "name", "image", "description" FROM "TokenMetadataCache" WHERE "mint" = $1`, mint,
        );
        if (cached?.[0]) {
          tokenData = {
            ticker: cached[0].name?.toUpperCase()?.slice(0, 10),
            tokenName: cached[0].name,
            tokenImage: cached[0].image,
            description: cached[0].description,
          };
        }
      } catch { /* cache table may not exist yet */ }
    }

    if (!tokenData) {
      res.status(404).json(errorResponse("Token not found"));
      return;
    }

    const indexerUrl = "https://proveindexer-production.up.railway.app";
    const imageUrl = tokenData.tokenImage
      ? `${indexerUrl}/api/metadata/${mint}/image`
      : null;

    const metadata = {
      name: tokenData.tokenName ?? tokenData.ticker ?? mint.slice(0, 8),
      symbol: tokenData.ticker ?? "",
      description: tokenData.description ?? `${tokenData.ticker ?? "Token"} — launched on Prove`,
      image: imageUrl,
      external_url: `https://proveit.fun/token/${mint}`,
      attributes: [],
      properties: {
        category: "fungible",
        creators: [],
      },
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(metadata);
  } catch (err) {
    console.error("[api] GET /api/metadata/:mint.json error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

// ─── GET /api/metadata/:mint/image ──────────────────────────
// Serves the token image from base64 stored in the DB.
router.get("/api/metadata/:mint/image", async (req: Request, res: Response) => {
  try {
    const mint = req.params.mint as string;
    if (!isValidSolanaAddress(mint)) {
      res.status(400).json(errorResponse("Invalid mint"));
      return;
    }

    let imageData: string | null = null;

    const auction = await prisma.auction.findUnique({
      where: { mint },
      select: { tokenImage: true },
    });
    imageData = auction?.tokenImage ?? null;

    if (!imageData) {
      // Check cache
      try {
        const cached = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "image" FROM "TokenMetadataCache" WHERE "mint" = $1`, mint,
        );
        imageData = cached?.[0]?.image ?? null;
      } catch { /* cache table may not exist */ }
    }

    if (!imageData) {
      res.status(404).json(errorResponse("Image not found"));
      return;
    }

    // Parse data URI: "data:image/png;base64,iVBOR..."
    const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      if (imageData.startsWith("http")) {
        res.redirect(imageData);
        return;
      }
      res.status(400).json(errorResponse("Invalid image format"));
      return;
    }

    const contentType = match[1];
    const imageBuffer = Buffer.from(match[2], "base64");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(imageBuffer);
  } catch (err) {
    console.error("[api] GET /api/metadata/:mint/image error:", err);
    res.status(500).json(errorResponse("Internal server error"));
  }
});

export default router;
