import { AuctionRow } from "@/components/AuctionRow";
import type { AuctionRowProps } from "@/components/AuctionRow";
import { TokenRow } from "@/components/TokenRow";
import type { TokenRowProps } from "@/components/TokenRow";
import { DiscoverClient } from "./DiscoverClient";

const API_BASE =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000";

/* ── API types ── */

interface AuctionResponse {
  mint: string;
  ticker: string;
  ends_at: number;
  participants: number;
  sol_committed: number;
  min_wallets: number;
  min_sol: number;
}

interface TokenResponse {
  mint: string;
  ticker: string;
  name: string;
  holder_count: number;
  volume_24h: number;
  avg_hold_time: string;
  price_change_pct: number;
  badges: Array<"verified" | "diamond_hands" | "survivor">;
  feed_score: number;
}

/* ── Mock data (shown when indexer is unavailable) ── */

const MOCK_AUCTIONS: AuctionRowProps[] = [
  {
    mint: "7nYB1HqKxVPR9ZdKNxjMRQfDf4KHnkVxAdrsVRnJPLRk",
    ticker: "ORBIT",
    endTime: Date.now() + 4 * 60 * 1000,
    participants: 38,
    solCommitted: 24_500_000_000,
    minWallets: 50,
    minSol: 10_000_000_000,
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    ticker: "NOVA",
    endTime: Date.now() + 2 * 60 * 1000 + 18 * 1000,
    participants: 47,
    solCommitted: 31_200_000_000,
    minWallets: 50,
    minSol: 10_000_000_000,
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ticker: "ZENITH",
    endTime: Date.now() + 1 * 60 * 1000 + 42 * 1000,
    participants: 52,
    solCommitted: 18_800_000_000,
    minWallets: 50,
    minSol: 10_000_000_000,
  },
];

const MOCK_TOKENS: TokenRowProps[] = [
  {
    mint: "So11111111111111111111111111111111111111112",
    ticker: "PROVE",
    name: "Prove Token",
    holderCount: 1_247,
    volume24h: 84_200_000_000,
    avgHoldTime: "4.2d",
    priceChange: 12.4,
    badges: ["verified", "diamond_hands"],
    feedScore: 94,
  },
  {
    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    ticker: "ALPHA",
    name: "Alpha Protocol",
    holderCount: 834,
    volume24h: 42_100_000_000,
    avgHoldTime: "3.1d",
    priceChange: -2.8,
    badges: ["verified", "survivor"],
    feedScore: 78,
  },
  {
    mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
    ticker: "BETA",
    name: "Beta Finance",
    holderCount: 621,
    volume24h: 28_400_000_000,
    avgHoldTime: "5.8d",
    priceChange: 8.1,
    badges: ["diamond_hands"],
    feedScore: 71,
  },
  {
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    ticker: "NEXUS",
    name: "Nexus Network",
    holderCount: 412,
    volume24h: 15_600_000_000,
    avgHoldTime: "2.4d",
    priceChange: 22.7,
    badges: ["survivor"],
    feedScore: 65,
  },
  {
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    ticker: "SIGMA",
    name: "Sigma DAO",
    holderCount: 289,
    volume24h: 9_800_000_000,
    avgHoldTime: "6.1d",
    priceChange: -5.3,
    badges: ["verified"],
    feedScore: 58,
  },
  {
    mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    ticker: "DRIFT",
    name: "Drift Protocol",
    holderCount: 178,
    volume24h: 6_200_000_000,
    avgHoldTime: "1.8d",
    priceChange: 4.6,
    badges: [],
    feedScore: 42,
  },
  {
    mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
    ticker: "VORTEX",
    name: "Vortex Exchange",
    holderCount: 156,
    volume24h: 4_100_000_000,
    avgHoldTime: "3.3d",
    priceChange: -1.2,
    badges: ["survivor"],
    feedScore: 38,
  },
];

/* ── Data fetchers ── */

async function getActiveAuctions(): Promise<AuctionRowProps[]> {
  try {
    const res = await fetch(`${API_BASE}/api/auctions/active`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return MOCK_AUCTIONS;
    const data: AuctionResponse[] = await res.json();
    if (data.length === 0) return MOCK_AUCTIONS;
    return data.map((a) => ({
      mint: a.mint,
      ticker: a.ticker,
      endTime: a.ends_at,
      participants: a.participants,
      solCommitted: a.sol_committed,
      minWallets: a.min_wallets ?? 50,
      minSol: a.min_sol ?? 10_000_000_000,
    }));
  } catch {
    return MOCK_AUCTIONS;
  }
}

async function getFeed(): Promise<TokenRowProps[]> {
  try {
    const res = await fetch(`${API_BASE}/api/feed`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return MOCK_TOKENS;
    const data: TokenResponse[] = await res.json();
    if (data.length === 0) return MOCK_TOKENS;
    return data.map((t) => ({
      mint: t.mint,
      ticker: t.ticker,
      name: t.name,
      holderCount: t.holder_count,
      volume24h: t.volume_24h,
      avgHoldTime: t.avg_hold_time,
      priceChange: t.price_change_pct,
      badges: t.badges,
      feedScore: t.feed_score,
    }));
  } catch {
    return MOCK_TOKENS;
  }
}

/* ── Page ── */

export default async function DiscoverPage() {
  const [auctions, tokens] = await Promise.all([
    getActiveAuctions(),
    getFeed(),
  ]);

  return <DiscoverClient auctions={auctions} tokens={tokens} />;
}
