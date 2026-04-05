import { prisma } from "./db";

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const SCORE_INTERVAL = HOUR_MS;
const BENEFITS_CAP = 70;
const DECAY_PER_WEEK = 2;

let timer: NodeJS.Timeout | undefined;

export function startScoreCalculator(): NodeJS.Timeout {
  console.log("[score] Starting score calculator (runs every hour)");
  timer = setInterval(calculateAllScores, SCORE_INTERVAL);
  // Run once on startup after a short delay
  setTimeout(calculateAllScores, 5_000);
  return timer;
}

async function calculateAllScores(): Promise<void> {
  console.log("[score] Recalculating all prove scores...");
  const startedAt = Date.now();

  try {
    // Gather all wallets that have any on-chain activity
    const wallets = await getActiveWallets();
    let updated = 0;

    for (const wallet of wallets) {
      try {
        await calculateWalletScore(wallet);
        updated++;
      } catch (err) {
        console.error(`[score] Failed to calculate score for ${wallet}:`, err);
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[score] Updated ${updated}/${wallets.length} scores in ${elapsed}s`);
  } catch (err) {
    console.error("[score] Batch score calculation failed:", err);
  }
}

async function getActiveWallets(): Promise<string[]> {
  // Union of wallets from commitments, swaps, and holder snapshots
  const [commitWallets, swapWallets, holderWallets] = await Promise.all([
    prisma.commitment.findMany({ select: { wallet: true }, distinct: ["wallet"] }),
    prisma.swap.findMany({ select: { wallet: true }, distinct: ["wallet"] }),
    prisma.holderSnapshot.findMany({ select: { wallet: true }, distinct: ["wallet"] }),
  ]);

  const all = new Set<string>();
  for (const r of commitWallets) all.add(r.wallet);
  for (const r of swapWallets) all.add(r.wallet);
  for (const r of holderWallets) all.add(r.wallet);
  return Array.from(all);
}

async function calculateWalletScore(wallet: string): Promise<void> {
  const now = new Date();

  // 1. Total hold time (hours) across all tokens, weighted by token survival
  const holdings = await prisma.holderSnapshot.findMany({
    where: { wallet, balance: { gt: 0 } },
  });

  let totalHoldTimeHours = 0;
  for (const h of holdings) {
    const holdMs = now.getTime() - h.firstSeen.getTime();
    const holdHours = holdMs / HOUR_MS;
    // Weight by whether the auction's token is still trading
    const auction = await prisma.auction.findUnique({ where: { mint: h.mint } });
    const weight = auction?.state === "TRADING" ? 1.0 : 0.5;
    totalHoldTimeHours += holdHours * weight;
  }

  // 2. Number of batch auctions participated in
  const auctionsParticipated = await prisma.commitment.count({ where: { wallet } });

  // 3. Quest contributions (count of quests on tokens the wallet holds)
  const heldMints = holdings.map((h) => h.mint);
  const questContributions = await prisma.quest.count({
    where: { auctionMint: { in: heldMints }, completed: true },
  });

  // 4. Early dump ratio: tokens sold within first hour vs total ever held
  const earlyDumpRatio = await computeEarlyDumpRatio(wallet);

  // 5. Compute raw score (0-100)
  // Benefits: hold time + auctions + quests, capped at 70
  const holdScore = Math.min(totalHoldTimeHours / 24, 25); // up to 25 pts for ~25 days
  const auctionScore = Math.min(auctionsParticipated * 5, 25); // up to 25 pts
  const questScore = Math.min(questContributions * 2, 20); // up to 20 pts
  const benefits = Math.min(holdScore + auctionScore + questScore, BENEFITS_CAP);

  // Penalty from early dumping (up to -30)
  const penalty = earlyDumpRatio * 30;

  // Inactivity decay: find the most recent activity
  const lastSwap = await prisma.swap.findFirst({
    where: { wallet },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  const lastCommitment = await prisma.commitment.findFirst({
    where: { wallet },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastActiveDate = new Date(
    Math.max(
      lastSwap?.timestamp.getTime() ?? 0,
      lastCommitment?.createdAt.getTime() ?? 0
    )
  );
  const weeksSinceActive = (now.getTime() - lastActiveDate.getTime()) / WEEK_MS;
  const decay = Math.floor(weeksSinceActive) * DECAY_PER_WEEK;

  const rawScore = benefits - penalty - decay;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  await prisma.proveScore.upsert({
    where: { wallet },
    create: {
      wallet,
      score,
      totalHoldTimeHours,
      auctionsParticipated,
      questContributions,
      earlyDumpRatio,
      lastActive: lastActiveDate.getTime() > 0 ? lastActiveDate : now,
    },
    update: {
      score,
      totalHoldTimeHours,
      auctionsParticipated,
      questContributions,
      earlyDumpRatio,
      lastActive: lastActiveDate.getTime() > 0 ? lastActiveDate : now,
    },
  });
}

async function computeEarlyDumpRatio(wallet: string): Promise<number> {
  // Find sells within first hour of holding each token
  const sells = await prisma.swap.findMany({
    where: { wallet, isBuy: false },
    select: { auctionMint: true, tokenAmount: true, timestamp: true },
  });

  if (sells.length === 0) return 0;

  let earlySold = BigInt(0);
  let totalSold = BigInt(0);

  for (const sell of sells) {
    totalSold += sell.tokenAmount;

    // Check when the wallet first acquired the token
    const holder = await prisma.holderSnapshot.findUnique({
      where: { mint_wallet: { mint: sell.auctionMint, wallet } },
      select: { firstSeen: true },
    });

    if (holder) {
      const msSinceFirst = sell.timestamp.getTime() - holder.firstSeen.getTime();
      if (msSinceFirst < HOUR_MS) {
        earlySold += sell.tokenAmount;
      }
    }
  }

  if (totalSold === BigInt(0)) return 0;
  return Number((earlySold * BigInt(1000)) / totalSold) / 1000;
}
