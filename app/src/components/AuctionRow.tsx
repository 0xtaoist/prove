"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./AuctionRow.module.css";

export interface AuctionRowProps {
  mint: string;
  ticker: string;
  endTime: number; // unix timestamp ms
  participants: number;
  solCommitted: number; // lamports
  minWallets: number;
  minSol: number; // lamports
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(2);
}

export function AuctionRow({
  mint,
  ticker,
  endTime,
  participants,
  solCommitted,
  minWallets,
  minSol,
}: AuctionRowProps) {
  const [remaining, setRemaining] = useState(endTime - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(endTime - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  const walletProgress = Math.min((participants / minWallets) * 100, 100);
  const ended = remaining <= 0;

  return (
    <Link href={`/batch/${mint}`} className={styles.row}>
      <div className={styles.tickerCell}>
        <span className={styles.dot} />
        <span className={styles.ticker}>${ticker}</span>
      </div>

      <div className={styles.countdownCell}>
        <span className={styles.countdown}>
          {ended ? "ended" : formatCountdown(remaining)}
        </span>
      </div>

      <div className={styles.statCell}>
        <span className={styles.statLabel}>wallets</span>
        <span className={styles.statValue}>{participants}</span>
      </div>

      <div className={styles.statCell}>
        <span className={styles.statLabel}>committed</span>
        <span className={styles.statValue}>{formatSol(solCommitted)} SOL</span>
      </div>

      <div className={styles.progressCell}>
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${walletProgress}%` }}
          />
        </div>
        <span className={styles.progressLabel}>
          {participants}/{minWallets} wallets
        </span>
      </div>

      <div className={styles.actionCell}>
        <span className={styles.commitLink}>commit &rarr;</span>
      </div>
    </Link>
  );
}
