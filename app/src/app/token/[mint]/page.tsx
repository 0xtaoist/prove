import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
      { label: "Verified", variant: "sage" as const },
      { label: "Diamond Hands", variant: "lavender" as const },
      { label: "Active", variant: "cream" as const },
    ],
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
        name: "Holder Milestone",
        description: "Reach 100 unique holders",
        current: 78,
        target: 100,
        completed: false,
        reward: "Unlocks community badge for all holders",
      },
      {
        id: "q2",
        name: "Hold Time",
        description: "Average hold time reaches 12 hours",
        current: 8,
        target: 12,
        completed: false,
        reward: "Fee discount for early holders",
      },
      {
        id: "q3",
        name: "Price Above Batch",
        description: "Maintain price above batch auction price for 48 hours",
        current: 32,
        target: 48,
        completed: false,
        reward: "Creator earns bonus allocation",
      },
      {
        id: "q4",
        name: "X Posts",
        description: "Community generates 50 posts mentioning $PROVE",
        current: 50,
        target: 50,
        completed: true,
        reward: "Unlocks social verification badge",
      },
      {
        id: "q5",
        name: "Graduation",
        description: "Reach 200 holders and complete 3 other quests",
        current: 1,
        target: 4,
        completed: false,
        reward: "Token graduates to full DEX listing",
      },
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

/* ── Badge variant map ── */

const BADGE_VARIANT: Record<string, string> = {
  sage: styles.badgeSage,
  lavender: styles.badgeLavender,
  cream: styles.badgeCream,
  rose: styles.badgeRose,
};

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
      {/* ── Band 1: Token Header ── */}
      <div className={styles.bandHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.ticker}>{data.ticker}</span>
          <span className={styles.tokenName}>{data.name}</span>
          <span className={styles.creatorLink}>
            Creator:{" "}
            <Link href={`/creator/${data.creatorFull}`}>
              {shortenAddress(data.creatorFull)}
            </Link>
          </span>
        </div>
        <div className={styles.headerRight}>
          {data.badges.map((b) => (
            <span
              key={b.label}
              className={`${styles.badge} ${BADGE_VARIANT[b.variant] ?? ""}`}
            >
              {b.label}
            </span>
          ))}
        </div>
        <span className={styles.batchPrice}>
          Batch auction price: {formatSol(data.stats.batchPrice)} SOL
        </span>
      </div>

      {/* ── Band 2: Price + Stats ── */}
      <div className={styles.bandStats}>
        <div className={styles.statsGrid}>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Current Price</div>
            <div className={styles.statValue}>
              {formatSol(data.price)} SOL
              <span
                className={`${styles.statChange} ${isPositive ? styles.statChangePositive : styles.statChangeNegative}`}
              >
                {isPositive ? "+" : ""}
                {data.change24h.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Holders</div>
            <div className={styles.statValue}>
              {data.stats.holders.toLocaleString()}
            </div>
          </div>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>24h Volume</div>
            <div className={styles.statValue}>
              {formatSol(data.stats.volume24h)} SOL
            </div>
          </div>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Market Cap</div>
            <div className={styles.statValue}>
              {formatSol(data.stats.marketCap)} SOL
            </div>
          </div>
          <div className={styles.statCell}>
            <div className={styles.statLabel}>Avg Hold Time</div>
            <div className={styles.statValue}>{data.stats.avgHoldTime}</div>
          </div>
        </div>
      </div>

      {/* ── Band 3: Trade Widget ── */}
      <div className={styles.bandTrade}>
        <div className={styles.chartArea}>
          <div className={styles.chartPlaceholder}>Chart coming soon</div>
        </div>
        <TradeWidget ticker={data.ticker} currentPrice={data.price} />
      </div>

      {/* ── Band 4: Quest Board Header ── */}
      <div className={styles.bandQuestHeader}>
        <span className={styles.kicker}>QUESTS</span>
      </div>

      {/* ── Band 5: Quest List ── */}
      <div className={styles.bandQuests}>
        {data.quests.map((q) => {
          const pct = Math.min(100, Math.round((q.current / q.target) * 100));
          return (
            <div key={q.id} className={styles.questRow}>
              <div className={styles.questInfo}>
                <span className={styles.questName}>{q.name}</span>
                <span className={styles.questDesc}>{q.description}</span>
              </div>
              <div className={styles.questProgressWrap}>
                <div className={styles.questProgressTrack}>
                  <div
                    className={`${styles.questProgressFill} ${q.completed ? styles.questProgressFillComplete : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={styles.questNumbers}>
                  {q.current}/{q.target}
                </span>
              </div>
              <span
                className={`${styles.questStatus} ${q.completed ? styles.questStatusDone : styles.questStatusProgress}`}
              >
                {q.completed ? "\u2713" : `${pct}%`}
              </span>
              <span className={styles.questReward}>{q.reward}</span>
            </div>
          );
        })}
      </div>

      {/* ── Band 6: Creator Section Header ── */}
      <div className={styles.bandCreatorHeader}>
        <span className={styles.kicker}>CREATOR</span>
      </div>

      {/* ── Band 7: Creator Info ── */}
      <div className={styles.bandCreator}>
        <div className={styles.creatorStat}>
          <span className={styles.creatorStatLabel}>Wallet</span>
          <span className={styles.creatorStatValue}>
            <Link href={`/creator/${data.creatorFull}`}>
              {shortenAddress(data.creatorFull)}
            </Link>
          </span>
        </div>
        <div className={styles.creatorStat}>
          <span className={styles.creatorStatLabel}>Total Fees Earned</span>
          <span className={styles.creatorStatValue}>
            {formatSol(data.creatorStats.totalFeesEarned)} SOL
          </span>
        </div>
        <div className={styles.creatorStat}>
          <span className={styles.creatorStatLabel}>Launches</span>
          <span className={styles.creatorStatValue}>
            {data.creatorStats.pastLaunches}
          </span>
        </div>
        <div className={styles.creatorStat}>
          <span className={styles.creatorStatLabel}>Stake Status</span>
          <span className={styles.creatorStatValue}>
            {data.creatorStats.stakeStatus}
          </span>
        </div>
      </div>

      {/* ── Band 8: Top Holders ── */}
      <div className={styles.bandHoldersHeader}>
        <span className={styles.kicker}>TOP HOLDERS</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className={styles.holderTable}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Wallet</th>
              <th>Balance</th>
              <th>Hold Time</th>
              <th>% of Supply</th>
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
                <td>{h.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
