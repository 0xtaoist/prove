import type { AuctionRowProps } from "@/components/AuctionRow";
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

const MOCK_AUCTIONS: AuctionRowProps[] = [];

const MOCK_TOKENS: TokenRowProps[] = [];

/* ── Data fetchers ── */

async function getActiveAuctions(): Promise<AuctionRowProps[]> {
  try {
    const res = await fetch(`${API_BASE}/api/auctions/active`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = await res.json();
    return data.map((a) => ({
      mint: a.mint,
      ticker: a.ticker,
      endTime: new Date(a.endTime).getTime(),
      participants: a.participantCount ?? a.participants ?? 0,
      solCommitted: Number(a.totalSol ?? a.sol_committed ?? 0),
      minWallets: a.minWallets ?? a.min_wallets ?? 20,
      minSol: Number(a.minSol ?? a.min_sol ?? 50_000_000_000),
    }));
  } catch {
    return [];
  }
}

async function getFeed(): Promise<TokenRowProps[]> {
  try {
    const res = await fetch(`${API_BASE}/api/feed`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data: TokenResponse[] = await res.json();
    if (data.length === 0) return [];
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
