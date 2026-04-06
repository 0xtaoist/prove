import Link from "next/link";
import styles from "./TokenRow.module.css";

export interface TokenRowProps {
  mint: string;
  ticker: string;
  name: string;
  holderCount: number;
  volume24h: number; // lamports
  avgHoldTime: string; // e.g. "4.2d"
  priceChange: number; // percent
  badges: Array<"verified" | "diamond_hands" | "survivor">;
  feedScore: number;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(2);
}

const BADGE_MAP: Record<string, { label: string; style: string }> = {
  verified: { label: "verified", style: "badgeVerified" },
  diamond_hands: { label: "diamond hands", style: "badgeDiamond" },
  survivor: { label: "survivor", style: "badgeSurvivor" },
};

export function TokenRow({
  mint,
  ticker,
  name,
  holderCount,
  volume24h,
  avgHoldTime,
  priceChange,
  badges,
  feedScore,
}: TokenRowProps) {
  const isPositive = priceChange >= 0;

  return (
    <Link href={`/token/${mint}`} className={styles.row}>
      {/* Left: identity */}
      <div className={styles.identity}>
        <span className={styles.ticker}>${ticker}</span>
        <span className={styles.name}>{name}</span>
      </div>

      {/* Middle: stats */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>holders</span>
          <span className={styles.statValue}>{holderCount.toLocaleString()}</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statLabel}>24h vol</span>
          <span className={styles.statValue}>{formatSol(volume24h)} SOL</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statLabel}>avg hold</span>
          <span className={styles.statValue}>{avgHoldTime}</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statLabel}>change</span>
          <span
            className={`${styles.statValue} ${isPositive ? styles.positive : styles.negative}`}
          >
            {isPositive ? "+" : ""}
            {priceChange.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Right: badges + score */}
      <div className={styles.meta}>
        {badges.length > 0 && (
          <div className={styles.badges}>
            {badges.map((b) => {
              const cfg = BADGE_MAP[b];
              if (!cfg) return null;
              return (
                <span
                  key={b}
                  className={`${styles.badge} ${styles[cfg.style]}`}
                >
                  {cfg.label}
                </span>
              );
            })}
          </div>
        )}
        <div className={styles.score}>
          <span className={styles.scoreNumber}>{feedScore}</span>
        </div>
      </div>
    </Link>
  );
}
