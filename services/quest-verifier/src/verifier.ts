import { prisma } from "./db";

const VERIFICATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startVerificationLoop(): NodeJS.Timeout {
  console.log("[verifier] Starting quest verification loop (every 5 minutes)");
  // Run once immediately, then on interval
  runVerification();
  return setInterval(runVerification, VERIFICATION_INTERVAL_MS);
}

async function runVerification(): Promise<void> {
  try {
    const activeQuests = await prisma.quest.findMany({
      where: { completed: false },
      include: { auction: true },
    });

    if (activeQuests.length === 0) {
      console.log("[verifier] No active quests to verify");
      return;
    }

    console.log(`[verifier] Checking ${activeQuests.length} active quests`);

    for (const quest of activeQuests) {
      try {
        switch (quest.type) {
          case "HOLDER_COUNT":
            await checkHolderCount(quest);
            break;
          case "HOLD_TIME":
            await checkHoldTime(quest);
            break;
          case "PRICE_ABOVE_BATCH":
            await checkPriceAboveBatch(quest);
            break;
          case "X_POSTS":
            await checkXPosts(quest);
            break;
          case "GRADUATION":
            await checkGraduation(quest);
            break;
        }
      } catch (err) {
        console.error(`[verifier] Error checking quest ${quest.id} (${quest.type}):`, err);
      }
    }
  } catch (err) {
    console.error("[verifier] Error in verification loop:", err);
  }
}

type QuestWithAuction = Awaited<ReturnType<typeof prisma.quest.findMany<{ include: { auction: true } }>>>[number];

async function completeQuest(quest: QuestWithAuction, current: number): Promise<void> {
  await prisma.quest.update({
    where: { id: quest.id },
    data: {
      current,
      completed: true,
      completedAt: new Date(),
    },
  });
  console.log(
    `[verifier] QUEST COMPLETED: ${quest.type} for mint=${quest.auctionMint} | Reward: ${quest.reward}`
  );
}

async function updateProgress(quest: QuestWithAuction, current: number): Promise<void> {
  await prisma.quest.update({
    where: { id: quest.id },
    data: { current },
  });
}

// ─── HOLDER_COUNT ───────────────────────────────────────

async function checkHolderCount(quest: QuestWithAuction): Promise<void> {
  const holderCount = await prisma.holderSnapshot.count({
    where: {
      mint: quest.auctionMint,
      balance: { gt: 0 },
    },
  });

  if (holderCount >= quest.target) {
    await completeQuest(quest, holderCount);
  } else {
    await updateProgress(quest, holderCount);
  }
}

// ─── HOLD_TIME ──────────────────────────────────────────

async function checkHoldTime(quest: QuestWithAuction): Promise<void> {
  const holders = await prisma.holderSnapshot.findMany({
    where: {
      mint: quest.auctionMint,
      balance: { gt: 0 },
    },
    select: { firstSeen: true },
  });

  if (holders.length === 0) {
    await updateProgress(quest, 0);
    return;
  }

  const now = Date.now();
  const totalHours = holders.reduce((sum, h) => {
    const hours = (now - h.firstSeen.getTime()) / (1000 * 60 * 60);
    return sum + hours;
  }, 0);
  const avgHours = totalHours / holders.length;
  const currentRounded = Math.floor(avgHours);

  if (avgHours >= quest.target) {
    await completeQuest(quest, currentRounded);
  } else {
    await updateProgress(quest, currentRounded);
  }
}

// ─── PRICE_ABOVE_BATCH ─────────────────────────────────

async function checkPriceAboveBatch(quest: QuestWithAuction): Promise<void> {
  const auction = quest.auction;
  if (!auction.uniformPrice) {
    await updateProgress(quest, 0);
    return;
  }

  const uniformPrice = auction.uniformPrice;

  // Get all swaps ordered by time to check continuous price above batch
  const swaps = await prisma.swap.findMany({
    where: { auctionMint: quest.auctionMint },
    orderBy: { timestamp: "asc" },
    select: { price: true, timestamp: true },
  });

  if (swaps.length === 0) {
    await updateProgress(quest, 0);
    return;
  }

  // Find the longest continuous streak where price >= uniformPrice
  let streakStartTime: Date | null = null;
  let maxContinuousHours = 0;

  for (const swap of swaps) {
    if (swap.price >= uniformPrice) {
      if (!streakStartTime) {
        streakStartTime = swap.timestamp;
      }
      const hours = (swap.timestamp.getTime() - streakStartTime.getTime()) / (1000 * 60 * 60);
      maxContinuousHours = Math.max(maxContinuousHours, hours);
    } else {
      streakStartTime = null;
    }
  }

  // Also check if the current streak extends to now (last swap was above)
  const lastSwap = swaps[swaps.length - 1];
  if (streakStartTime && lastSwap.price >= uniformPrice) {
    const hoursToNow = (Date.now() - streakStartTime.getTime()) / (1000 * 60 * 60);
    maxContinuousHours = Math.max(maxContinuousHours, hoursToNow);
  }

  const currentRounded = Math.floor(maxContinuousHours);

  if (maxContinuousHours >= quest.target) {
    await completeQuest(quest, currentRounded);
  } else {
    await updateProgress(quest, currentRounded);
  }
}

// ─── X_POSTS ────────────────────────────────────────────

async function checkXPosts(quest: QuestWithAuction): Promise<void> {
  const bearerToken = process.env.X_API_BEARER_TOKEN;
  if (!bearerToken) {
    console.log("[verifier] X_API_BEARER_TOKEN not set, skipping X_POSTS check");
    return;
  }

  try {
    const ticker = quest.auction.ticker;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      query: `$${ticker}`,
      start_time: twoHoursAgo,
      max_results: "100",
      "tweet.fields": "author_id",
    });

    const response = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${bearerToken}` },
      }
    );

    if (!response.ok) {
      console.error(`[verifier] X API returned ${response.status}: ${response.statusText}`);
      return;
    }

    const data = await response.json() as { meta?: { result_count?: number }; data?: Array<{ author_id: string }> };
    const tweets = data.data || [];

    // Count unique authors
    const uniqueAuthors = new Set(tweets.map((t: { author_id: string }) => t.author_id));
    const uniqueCount = uniqueAuthors.size;

    if (uniqueCount >= quest.target) {
      await completeQuest(quest, uniqueCount);
    } else {
      await updateProgress(quest, uniqueCount);
    }
  } catch (err) {
    console.error("[verifier] Error checking X posts:", err);
  }
}

// ─── GRADUATION ─────────────────────────────────────────

async function checkGraduation(quest: QuestWithAuction): Promise<void> {
  const holderCount = await prisma.holderSnapshot.count({
    where: {
      mint: quest.auctionMint,
      balance: { gt: 0 },
    },
  });

  const completedQuests = await prisma.quest.count({
    where: {
      auctionMint: quest.auctionMint,
      completed: true,
    },
  });

  const meetsHolders = holderCount >= 200;
  const meetsQuests = completedQuests >= 3;

  if (meetsHolders && meetsQuests) {
    await completeQuest(quest, 1);
  } else {
    await updateProgress(quest, 0);
  }
}
