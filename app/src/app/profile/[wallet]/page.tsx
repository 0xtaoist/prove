import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProveScoreRing } from "@/components/ProveScoreRing";
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

function getProfileData(wallet: string) {
  return {
    wallet,
    proveScore: 67,
    breakdown: {
      totalHoldTime: "42.3d",
      auctionsParticipated: 8,
      questContributions: 14,
      earlyDumpRatio: 0.12,
    },
    lastActive: "2026-04-03",
    scoreDecay: "0.5/day (inactive >7d)",
    holdings: [
      {
        mint: "abc123",
        ticker: "$PROVE",
        balance: 12_500,
        pnl: 2_400_000_000,
        holdDuration: "12.3d",
      },
      {
        mint: "def456",
        ticker: "$ALPHA",
        balance: 8_200,
        pnl: -800_000_000,
        holdDuration: "5.1d",
      },
      {
        mint: "ghi789",
        ticker: "$BETA",
        balance: 45_000,
        pnl: 600_000_000,
        holdDuration: "2.8d",
      },
    ],
    auctions: [
      {
        id: "a1",
        token: "$PROVE",
        mint: "abc123",
        outcome: "succeeded" as const,
        tokensClaimed: 5_000,
        solCommitted: 2_500_000_000,
        date: "2026-03-20",
      },
      {
        id: "a2",
        token: "$GAMMA",
        mint: "jkl012",
        outcome: "failed" as const,
        tokensClaimed: 0,
        solCommitted: 1_000_000_000,
        date: "2026-03-15",
      },
      {
        id: "a3",
        token: "$ALPHA",
        mint: "def456",
        outcome: "succeeded" as const,
        tokensClaimed: 8_200,
        solCommitted: 3_200_000_000,
        date: "2026-03-10",
      },
    ],
  };
}

/* ── Page ── */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>;
}): Promise<Metadata> {
  const { wallet } = await params;
  if (!BASE58_RE.test(wallet)) return { title: "Not Found — PROVE" };
  return { title: `Profile ${shortenAddress(wallet)} — PROVE` };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;
  if (!BASE58_RE.test(wallet)) notFound();
  const data = getProfileData(wallet);

  return (
    <div className={styles.page}>
      {/* Score Hero */}
      <div className={styles.scoreHero}>
        <ProveScoreRing score={data.proveScore} size={140} />
        <div className={styles.walletInfo}>
          <span className={styles.walletLabel}>Wallet</span>
          <span className={styles.walletAddress}>
            {shortenAddress(data.wallet)}
          </span>
        </div>
      </div>

      {/* Score breakdown */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Score Breakdown</h2>
        <div className={styles.breakdownGrid}>
          <div className={styles.breakdownCard}>
            <div className={styles.breakdownLabel}>Total Hold Time</div>
            <div className={styles.breakdownValue}>
              {data.breakdown.totalHoldTime}
            </div>
          </div>
          <div className={styles.breakdownCard}>
            <div className={styles.breakdownLabel}>Auctions Participated</div>
            <div className={styles.breakdownValue}>
              {data.breakdown.auctionsParticipated}
            </div>
          </div>
          <div className={styles.breakdownCard}>
            <div className={styles.breakdownLabel}>Quest Contributions</div>
            <div className={styles.breakdownValue}>
              {data.breakdown.questContributions}
            </div>
          </div>
          <div className={styles.breakdownCard}>
            <div className={styles.breakdownLabel}>Early Dump Ratio</div>
            <div
              className={styles.breakdownValue}
              style={{
                color:
                  data.breakdown.earlyDumpRatio > 0.3
                    ? "var(--danger)"
                    : data.breakdown.earlyDumpRatio > 0.15
                      ? "var(--warning)"
                      : "var(--success)",
              }}
            >
              {(data.breakdown.earlyDumpRatio * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Stats</h2>
        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statItemLabel}>Last Active</span>
            <span className={styles.statItemValue}>{data.lastActive}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statItemLabel}>Score Decay</span>
            <span className={styles.statItemValue}>{data.scoreDecay}</span>
          </div>
        </div>
      </div>

      {/* Token Holdings */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Token Holdings</h2>
        <div style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Token</th>
                <th>Balance</th>
                <th>Unrealized PnL</th>
                <th>Hold Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.mint}>
                  <td>
                    <Link href={`/token/${h.mint}`}>{h.ticker}</Link>
                  </td>
                  <td>{h.balance.toLocaleString()}</td>
                  <td
                    className={h.pnl >= 0 ? styles.positive : styles.negative}
                  >
                    {h.pnl >= 0 ? "+" : ""}
                    {formatSol(h.pnl)} SOL
                  </td>
                  <td>{h.holdDuration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auction History */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Auction History</h2>
        <div style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Token</th>
                <th>SOL Committed</th>
                <th>Tokens Claimed</th>
                <th>Outcome</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.auctions.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/token/${a.mint}`}>{a.token}</Link>
                  </td>
                  <td>{formatSol(a.solCommitted)} SOL</td>
                  <td>{a.tokensClaimed.toLocaleString()}</td>
                  <td
                    className={
                      a.outcome === "succeeded"
                        ? styles.outcomeSucceeded
                        : styles.outcomeFailed
                    }
                  >
                    {a.outcome}
                  </td>
                  <td>{a.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
