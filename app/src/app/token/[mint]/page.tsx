import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuestCard, type QuestData } from "@/components/QuestCard";
import { TradeWidget } from "./TradeWidget";
import styles from "./page.module.css";

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

function getTokenData(mint: string) {
  return {
    mint,
    ticker: "$PROVE",
    name: "Prove Token",
    creator: "8xDf2...r4Kp",
    creatorFull: "8xDf2abc1234def5678ghijklmnopqrstuv9r4Kp",
    badges: ["Active", "Staked"],
    price: 42_500_000, // lamports
    change24h: 12.4,
    stats: {
      holders: 1_247,
      volume24h: 84_200_000_000,
      marketCap: 2_100_000_000_000,
      avgHoldTime: "4.2d",
      batchPrice: 38_000_000,
    },
    quests: [
      {
        id: "q1",
        type: "hold",
        title: "Diamond Hands",
        description: "Hold for 7 days without selling",
        current: 5,
        target: 7,
        completed: false,
        reward: "+5 Prove Score",
      },
      {
        id: "q2",
        type: "trade",
        title: "Volume Driver",
        description: "Generate 10 SOL in trade volume",
        current: 10,
        target: 10,
        completed: true,
        reward: "+3 Prove Score",
      },
      {
        id: "q3",
        type: "refer",
        title: "Community Builder",
        description: "Refer 3 new holders",
        current: 1,
        target: 3,
        completed: false,
        reward: "+4 Prove Score",
      },
      {
        id: "q4",
        type: "stake",
        title: "Staker",
        description: "Stake tokens for 14 days",
        current: 14,
        target: 14,
        completed: true,
        reward: "+6 Prove Score",
      },
      {
        id: "q5",
        type: "vote",
        title: "Governance",
        description: "Vote on 2 community proposals",
        current: 0,
        target: 2,
        completed: false,
        reward: "+2 Prove Score",
      },
    ] satisfies QuestData[],
    creatorStats: {
      totalFeesEarned: 15_800_000_000,
      pastLaunches: 3,
    },
    holders: [
      { wallet: "9kRf3...dL2q", balance: 1_250_000, holdTime: "12.3d" },
      { wallet: "4mPa7...nW8x", balance: 980_000, holdTime: "10.1d" },
      { wallet: "7jLk1...hY6r", balance: 750_000, holdTime: "8.7d" },
      { wallet: "2sTn9...bQ4m", balance: 620_000, holdTime: "7.2d" },
      { wallet: "5vCx8...pZ1k", balance: 510_000, holdTime: "6.9d" },
      { wallet: "3wFe2...gR7n", balance: 440_000, holdTime: "5.4d" },
      { wallet: "8bHj6...cT3s", balance: 380_000, holdTime: "4.8d" },
      { wallet: "1dKm4...eU9w", balance: 310_000, holdTime: "3.6d" },
      { wallet: "6pNr5...aV2y", balance: 260_000, holdTime: "2.1d" },
      { wallet: "0qAs7...fX5j", balance: 190_000, holdTime: "1.4d" },
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
  if (!BASE58_RE.test(mint)) return { title: "Not Found — PROVE" };
  const data = getTokenData(mint);
  return { title: `${data.ticker} — PROVE` };
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  if (!BASE58_RE.test(mint)) notFound();
  const data = getTokenData(mint);
  const isPositive = data.change24h >= 0;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.ticker}>{data.ticker}</span>
        <div className={styles.headerMeta}>
          <span className={styles.tokenName}>{data.name}</span>
          <span className={styles.creator}>
            Creator:{" "}
            <Link href={`/creator/${data.creatorFull}`}>
              {data.creator}
            </Link>
          </span>
        </div>
        <div className={styles.badges}>
          {data.badges.map((b) => (
            <span key={b} className="badge badge-accent">
              {b}
            </span>
          ))}
        </div>
      </div>

      {/* Main: Price + Trade */}
      <div className={styles.main}>
        <div className={styles.priceSection}>
          <div className={styles.priceRow}>
            <span className={styles.priceValue}>
              {formatSol(data.price)} SOL
            </span>
            <span
              className={styles.priceChange}
              style={{ color: isPositive ? "var(--success)" : "var(--danger)" }}
            >
              {isPositive ? "+" : ""}
              {data.change24h.toFixed(1)}%
            </span>
          </div>
          <div className={styles.chartPlaceholder}>Price chart coming soon</div>
        </div>
        <TradeWidget ticker={data.ticker} currentPrice={data.price} />
      </div>

      {/* Stats grid */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Holders</div>
          <div className={styles.statValue}>
            {data.stats.holders.toLocaleString()}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>24h Volume</div>
          <div className={styles.statValue}>
            {formatSol(data.stats.volume24h)} SOL
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Market Cap</div>
          <div className={styles.statValue}>
            {formatSol(data.stats.marketCap)} SOL
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Avg Hold Time</div>
          <div className={styles.statValue}>{data.stats.avgHoldTime}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Batch Auction Price</div>
          <div className={styles.statValue}>
            {formatSol(data.stats.batchPrice)} SOL
          </div>
        </div>
      </div>

      {/* Quest Board */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Quest Board</h2>
        <div className={styles.questList}>
          {data.quests.map((q) => (
            <QuestCard key={q.id} quest={q} />
          ))}
        </div>
      </div>

      {/* Creator section */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Creator</h2>
        <div className={styles.creatorCard}>
          <div className={styles.creatorInfo}>
            <span className={styles.creatorWallet}>
              <Link href={`/creator/${data.creatorFull}`}>
                {shortenAddress(data.creatorFull)}
              </Link>
            </span>
            <span className={styles.creatorStat}>
              Fees earned: {formatSol(data.creatorStats.totalFeesEarned)} SOL
            </span>
            <span className={styles.creatorStat}>
              Past launches: {data.creatorStats.pastLaunches}
            </span>
          </div>
        </div>
      </div>

      {/* Holder list */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Top Holders</h2>
        <div style={{ overflowX: "auto" }}>
          <table className={styles.holderTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>Wallet</th>
                <th>Balance</th>
                <th>Hold Time</th>
              </tr>
            </thead>
            <tbody>
              {data.holders.map((h, i) => (
                <tr key={h.wallet}>
                  <td>{i + 1}</td>
                  <td>
                    <Link href={`/profile/${h.wallet}`}>{h.wallet}</Link>
                  </td>
                  <td>{h.balance.toLocaleString()}</td>
                  <td>{h.holdTime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
