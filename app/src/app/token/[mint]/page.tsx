import { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenDetailClient } from "./TokenDetailClient";

/* ── Helpers ── */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function shortenAddress(addr: string): string {
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/* ── Mock data ── */

interface QuestItem {
  id: string;
  name: string;
  description: string;
  current: number;
  target: number;
  completed: boolean;
  reward: string;
}

function getTokenData(mint: string) {
  const totalSupply = 10_000_000;
  return {
    mint,
    ticker: "$PROVE",
    name: "Prove Token",
    creatorFull: "8xDf2abc1234def5678ghijklmnopqrstuv9r4Kp",
    badges: [
      { label: "Verified", variant: "primary" as const },
      { label: "Diamond Hands", variant: "success" as const },
      { label: "Active", variant: "warning" as const },
    ],
    price: 42_500_000,
    change24h: 12.4,
    stats: {
      holders: 1_247,
      volume24h: 84_200_000_000,
      marketCap: 2_100_000_000_000,
      avgHoldTime: "4.2d",
      batchPrice: 38_000_000,
    },
    quests: [
      { id: "q1", name: "Holder Milestone", description: "Reach 100 unique holders", current: 78, target: 100, completed: false, reward: "Unlocks community badge for all holders" },
      { id: "q2", name: "Hold Time", description: "Average hold time reaches 12 hours", current: 8, target: 12, completed: false, reward: "Fee discount for early holders" },
      { id: "q3", name: "Price Above Batch", description: "Maintain price above batch auction price for 48 hours", current: 32, target: 48, completed: false, reward: "Creator earns bonus allocation" },
      { id: "q4", name: "X Posts", description: "Community generates 50 posts mentioning $PROVE", current: 50, target: 50, completed: true, reward: "Unlocks social verification badge" },
      { id: "q5", name: "Graduation", description: "Reach 200 holders and complete 3 other quests", current: 1, target: 4, completed: false, reward: "Token graduates to full DEX listing" },
    ] as QuestItem[],
    creatorStats: {
      totalFeesEarned: 15_800_000_000,
      pastLaunches: 3,
      stakeStatus: "Staked",
    },
    totalSupply,
    holders: [
      { wallet: "9kRf3...dL2q", balance: 1_250_000, holdTime: "12.3d", pct: ((1_250_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "4mPa7...nW8x", balance: 980_000, holdTime: "10.1d", pct: ((980_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "7jLk1...hY6r", balance: 750_000, holdTime: "8.7d", pct: ((750_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "2sTn9...bQ4m", balance: 620_000, holdTime: "7.2d", pct: ((620_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "5vCx8...pZ1k", balance: 510_000, holdTime: "6.9d", pct: ((510_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "3wFe2...gR7n", balance: 440_000, holdTime: "5.4d", pct: ((440_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "8bHj6...cT3s", balance: 380_000, holdTime: "4.8d", pct: ((380_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "1dKm4...eU9w", balance: 310_000, holdTime: "3.6d", pct: ((310_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "6pNr5...aV2y", balance: 260_000, holdTime: "2.1d", pct: ((260_000 / totalSupply) * 100).toFixed(2) },
      { wallet: "0qAs7...fX5j", balance: 190_000, holdTime: "1.4d", pct: ((190_000 / totalSupply) * 100).toFixed(2) },
    ],
  };
}

/* ── Page ── */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<Metadata> {
  const { mint } = await params;
  if (!BASE58_RE.test(mint)) return { title: "Not Found \u2014 PROVE" };
  const data = getTokenData(mint);
  return { title: `${data.ticker} \u2014 PROVE` };
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  if (!BASE58_RE.test(mint)) notFound();
  const data = getTokenData(mint);

  return (
    <TokenDetailClient
      data={{
        ...data,
        mint,
        formattedPrice: formatSol(data.price),
        formattedVolume: formatSol(data.stats.volume24h),
        formattedMarketCap: formatSol(data.stats.marketCap),
        formattedBatchPrice: formatSol(data.stats.batchPrice),
        formattedCreatorFees: formatSol(data.creatorStats.totalFeesEarned),
        shortenedCreator: shortenAddress(data.creatorFull),
      }}
    />
  );
}
