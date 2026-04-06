import Link from "next/link";
import { AuctionRow } from "@/components/AuctionRow";
import type { AuctionRowProps } from "@/components/AuctionRow";
import { TokenRow } from "@/components/TokenRow";
import type { TokenRowProps } from "@/components/TokenRow";
import styles from "./page.module.css";

const API_BASE = process.env.INDEXER_API_URL ?? "http://localhost:4000";

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

/* ── Data fetchers ── */

async function getActiveAuctions(): Promise<AuctionRowProps[]> {
  try {
    const res = await fetch(`${API_BASE}/api/auctions/active`, {
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    const data: AuctionResponse[] = await res.json();
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
    return [];
  }
}

/* ── Skeleton for loading state ── */

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonTicker} />
          <div className={styles.skeletonStat} />
          <div className={styles.skeletonStat} />
          <div className={styles.skeletonStat} />
          <div className={styles.skeletonBadge} />
          <div className={styles.skeletonScore} />
        </div>
      ))}
    </>
  );
}

/* ── Page ── */

export default async function DiscoverPage() {
  const [auctions, tokens] = await Promise.all([
    getActiveAuctions(),
    getFeed(),
  ]);

  return (
    <div className={styles.page}>
      {/* Band 1: Page header */}
      <section className={styles.headerBand}>
        <p className={styles.kicker}>DISCOVER</p>
        <h1 className={styles.heading}>tokens that proved themselves.</h1>
        <p className={styles.subtitle}>
          Only surviving tokens appear here. No noise.
        </p>
      </section>

      {/* Band 2: Auctions section header */}
      <section className={styles.auctionHeaderBand}>
        <div className={styles.sectionLeft}>
          <span className={styles.sectionKicker}>LIVE AUCTIONS</span>
          <span className={styles.countBadge}>{auctions.length}</span>
        </div>
        <div className={styles.liveIndicator}>
          <span className={styles.greenDot} />
          <span>gathering now</span>
        </div>
      </section>

      {/* Band 3: Active auctions list */}
      <section className={styles.auctionList}>
        {auctions.length === 0 ? (
          <p className={styles.emptyState}>no active auctions right now.</p>
        ) : (
          auctions.map((a) => <AuctionRow key={a.mint} {...a} />)
        )}
      </section>

      {/* Band 4: Token feed header */}
      <section className={styles.feedHeaderBand}>
        <div className={styles.sectionLeft}>
          <span className={styles.sectionKicker}>TOKEN FEED</span>
        </div>
        <div className={styles.sortControls}>
          <button className={styles.sortBtnActive}>holders</button>
          <button className={styles.sortBtn}>volume</button>
          <button className={styles.sortBtn}>hold time</button>
          <button className={styles.sortBtn}>score</button>
        </div>
      </section>

      {/* Band 5: Token feed */}
      <section className={styles.tokenFeed}>
        {tokens.length === 0 ? (
          <p className={styles.emptyState}>
            no tokens yet. be first to launch.
          </p>
        ) : (
          tokens.map((t) => <TokenRow key={t.mint} {...t} />)
        )}
      </section>

      {/* Band 6: How to get listed */}
      <section className={styles.ctaBand}>
        <p className={styles.ctaText}>
          launch through a batch auction. if 50+ wallets join and 10+ SOL is
          committed, your token goes live.
        </p>
        <Link href="/launch" className={styles.ctaLink}>
          launch a token &rarr;
        </Link>
      </section>
    </div>
  );
}
