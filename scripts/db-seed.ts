import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Clean existing data (in reverse FK order)
  await prisma.quest.deleteMany();
  await prisma.swap.deleteMany();
  await prisma.commitment.deleteMany();
  await prisma.stake.deleteMany();
  await prisma.creatorFee.deleteMany();
  await prisma.holderSnapshot.deleteMany();
  await prisma.tickerEntry.deleteMany();
  await prisma.proveScore.deleteMany();
  await prisma.forfeitPool.deleteMany();
  await prisma.auction.deleteMany();

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const inOneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // --- Auction 1: GATHERING (active) ---
  const auction1 = await prisma.auction.create({
    data: {
      mint: "mint_gathering_abc111",
      ticker: "ALPHA",
      creator: "creator_wallet_aaa",
      startTime: hourAgo,
      endTime: inOneHour,
      totalSol: BigInt(50_000_000_000), // 50 SOL in lamports
      totalSupply: BigInt(1_000_000_000_000),
      participantCount: 2,
      state: "GATHERING",
      tokenName: "Alpha Token",
      description: "A test gathering auction",
    },
  });

  // Commitments for auction 1
  await prisma.commitment.createMany({
    data: [
      {
        auctionMint: auction1.mint,
        wallet: "wallet_user_111",
        solAmount: BigInt(30_000_000_000),
      },
      {
        auctionMint: auction1.mint,
        wallet: "wallet_user_222",
        solAmount: BigInt(20_000_000_000),
      },
    ],
  });

  // Stake for auction 1
  await prisma.stake.create({
    data: {
      auctionMint: auction1.mint,
      creator: auction1.creator,
      amount: BigInt(5_000_000_000),
      milestoneDeadline: inOneWeek,
      state: "ESCROWED",
    },
  });

  // --- Auction 2: TRADING (succeeded and now trading) ---
  const auction2 = await prisma.auction.create({
    data: {
      mint: "mint_trading_bbb222",
      ticker: "BETA",
      creator: "creator_wallet_bbb",
      startTime: weekAgo,
      endTime: dayAgo,
      totalSol: BigInt(200_000_000_000),
      totalSupply: BigInt(1_000_000_000_000),
      participantCount: 3,
      state: "TRADING",
      uniformPrice: BigInt(200_000),
      tokenName: "Beta Token",
      tokenImage: "https://example.com/beta.png",
      description: "A successfully launched token now trading",
    },
  });

  // Commitments for auction 2
  await prisma.commitment.createMany({
    data: [
      {
        auctionMint: auction2.mint,
        wallet: "wallet_user_111",
        solAmount: BigInt(80_000_000_000),
        tokensClaimed: true,
      },
      {
        auctionMint: auction2.mint,
        wallet: "wallet_user_222",
        solAmount: BigInt(70_000_000_000),
        tokensClaimed: true,
      },
      {
        auctionMint: auction2.mint,
        wallet: "wallet_user_333",
        solAmount: BigInt(50_000_000_000),
        tokensClaimed: true,
      },
    ],
  });

  // Swaps for auction 2
  await prisma.swap.createMany({
    data: [
      {
        auctionMint: auction2.mint,
        wallet: "wallet_user_111",
        isBuy: false,
        solAmount: BigInt(10_000_000_000),
        tokenAmount: BigInt(50_000_000_000),
        creatorFee: BigInt(100_000_000),
        protocolFee: BigInt(50_000_000),
        price: BigInt(200_000),
        signature: "sig_swap_001",
        timestamp: hourAgo,
      },
      {
        auctionMint: auction2.mint,
        wallet: "wallet_user_333",
        isBuy: true,
        solAmount: BigInt(5_000_000_000),
        tokenAmount: BigInt(24_000_000_000),
        creatorFee: BigInt(50_000_000),
        protocolFee: BigInt(25_000_000),
        price: BigInt(208_333),
        signature: "sig_swap_002",
        timestamp: now,
      },
    ],
  });

  // Stake for auction 2 (returned)
  await prisma.stake.create({
    data: {
      auctionMint: auction2.mint,
      creator: auction2.creator,
      amount: BigInt(10_000_000_000),
      milestoneDeadline: inOneWeek,
      state: "RETURNED",
      evaluatedAt: dayAgo,
    },
  });

  // Quests for auction 2
  await prisma.quest.createMany({
    data: [
      {
        auctionMint: auction2.mint,
        type: "HOLDER_COUNT",
        target: 100,
        current: 45,
        completed: false,
        reward: "Unlock community badge",
      },
      {
        auctionMint: auction2.mint,
        type: "X_POSTS",
        target: 50,
        current: 50,
        completed: true,
        completedAt: hourAgo,
        reward: "500 bonus tokens airdrop",
      },
      {
        auctionMint: auction2.mint,
        type: "HOLD_TIME",
        target: 168, // hours
        current: 72,
        completed: false,
        reward: "Diamond hands NFT",
      },
    ],
  });

  // Creator fee for auction 2
  await prisma.creatorFee.create({
    data: {
      mint: auction2.mint,
      creator: auction2.creator,
      totalEarned: BigInt(150_000_000),
      totalWithdrawn: BigInt(0),
    },
  });

  // --- Auction 3: FAILED ---
  await prisma.auction.create({
    data: {
      mint: "mint_failed_ccc333",
      ticker: "GAMMA",
      creator: "creator_wallet_ccc",
      startTime: weekAgo,
      endTime: dayAgo,
      totalSol: BigInt(5_000_000_000),
      totalSupply: BigInt(1_000_000_000_000),
      participantCount: 1,
      state: "FAILED",
      tokenName: "Gamma Token",
      description: "An auction that did not meet its goal",
    },
  });

  // One commitment for the failed auction (refundable)
  await prisma.commitment.create({
    data: {
      auctionMint: "mint_failed_ccc333",
      wallet: "wallet_user_222",
      solAmount: BigInt(5_000_000_000),
    },
  });

  // --- Ticker entries ---
  await prisma.tickerEntry.createMany({
    data: [
      {
        ticker: "ALPHA",
        mint: "mint_gathering_abc111",
        ttlExpiry: inOneWeek,
        active: true,
      },
      {
        ticker: "BETA",
        mint: "mint_trading_bbb222",
        ttlExpiry: inOneWeek,
        active: true,
      },
      {
        ticker: "GAMMA",
        mint: "mint_failed_ccc333",
        ttlExpiry: dayAgo,
        active: false,
      },
    ],
  });

  // --- Holder snapshots for BETA ---
  await prisma.holderSnapshot.createMany({
    data: [
      {
        mint: "mint_trading_bbb222",
        wallet: "wallet_user_111",
        balance: BigInt(350_000_000_000),
        firstSeen: weekAgo,
      },
      {
        mint: "mint_trading_bbb222",
        wallet: "wallet_user_222",
        balance: BigInt(350_000_000_000),
        firstSeen: weekAgo,
      },
      {
        mint: "mint_trading_bbb222",
        wallet: "wallet_user_333",
        balance: BigInt(300_000_000_000),
        firstSeen: weekAgo,
      },
    ],
  });

  // --- ProveScore ---
  await prisma.proveScore.create({
    data: {
      wallet: "wallet_user_111",
      score: 750,
      totalHoldTimeHours: 168.5,
      auctionsParticipated: 2,
      questContributions: 3,
      earlyDumpRatio: 0.1,
      lastActive: now,
    },
  });

  // --- ForfeitPool ---
  await prisma.forfeitPool.create({
    data: {
      totalForfeited: BigInt(0),
    },
  });

  console.log("Seed complete!");
  console.log("  - 3 auctions (GATHERING, TRADING, FAILED)");
  console.log("  - 6 commitments");
  console.log("  - 2 swaps");
  console.log("  - 2 stakes");
  console.log("  - 3 quests");
  console.log("  - 1 creator fee entry");
  console.log("  - 3 ticker entries");
  console.log("  - 3 holder snapshots");
  console.log("  - 1 ProveScore");
  console.log("  - 1 ForfeitPool");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
