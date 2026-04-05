import Link from "next/link";
import styles from "./TokenCard.module.css";

export interface TokenCardProps {
  mint: string;
  ticker: string;
  name: string;
  holderCount: number;
  volume24h: number; // lamports
  avgHoldTime: string; // e.g. "4.2d"
  priceChangePct: number;
  badges: Array<"verified" | "diamond_hands" | "survivor">;
  feedScore: number;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(2);
}

const BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  verified: { label: "Verified", className: "badgeVerified" },
  diamond_hands: { label: "Diamond Hands", className: "badgeDiamond" },
  survivor: { label: "Survivor", className: "badgeSurvivor" },
};

export function TokenCard({
  mint,
  ticker,
  name,
  holderCount,
  volume24h,
  avgHoldTime,
  priceChangePct,
  badges,
  feedScore,
}: TokenCardProps) {
  const isPositive = priceChangePct >= 0;

  return (
    <Link href={`/token/${mint}`} className={styles.card}>
      <div className={styles.header}>
        <span className={styles.ticker}>${ticker}</span>
        <span
          className={`${styles.priceChange} ${isPositive ? styles.positive : styles.negative}`}
        >
          {isPositive ? "+" : ""}
          {priceChangePct.toFixed(1)}%
        </span>
      </div>
      <div className={styles.name}>{name}</div>

      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Holders</span>
          <span className={styles.statValue}>{holderCount.toLocaleString()}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>24h Vol</span>
          <span className={styles.statValue}>{formatSol(volume24h)} SOL</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg Hold</span>
          <span className={styles.statValue}>{avgHoldTime}</span>
        </div>
      </div>

      {badges.length > 0 && (
        <div className={styles.badges}>
          {badges.map((b) => {
            const cfg = BADGE_CONFIG[b];
            if (!cfg) return null;
            return (
              <span
                key={b}
                className={`${styles.badge} ${styles[cfg.className]}`}
              >
                {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      <div className={styles.score}>
        <span className={styles.scoreLabel}>Feed Score</span>
        <span className={styles.scoreValue}>{feedScore}</span>
      </div>
    </Link>
  );
}
