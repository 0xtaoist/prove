"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTransaction } from "../../../hooks/useTransaction";
import { usePrivyWallet } from "../../../hooks/usePrivyWallet";
import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";

/* ── Helpers ── */

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function formatSol(lamports: number): string {
  return (lamports / 1e9).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/* ── Mock data ── */

interface TokenBreakdown {
  mint: string;
  ticker: string;
  dailyVolume: number;
  dailyFees: number;
  totalFees: number;
  holders: number;
  stakeStatus: "Escrowed" | "Returned" | "Forfeited";
}

interface StakeInfo {
  ticker: string;
  status: "Escrowed" | "Returned" | "Forfeited";
  deadline: string;
  amount: number;
}

interface LaunchRecord {
  ticker: string;
  mint: string;
  outcome: "succeeded" | "failed";
  participants: number;
  solRaised: number;
  date: string;
}

function getCreatorData() {
  return {
    totalFees: 28_400_000_000,
    totalWithdrawn: 20_000_000_000,
    pending: 8_400_000_000,
    tokens: [
      { mint: "abc123", ticker: "$PROVE", dailyVolume: 12_500_000_000, dailyFees: 100_000_000, totalFees: 15_800_000_000, holders: 1_247, stakeStatus: "Escrowed" },
      { mint: "def456", ticker: "$ALPHA", dailyVolume: 6_200_000_000, dailyFees: 49_600_000, totalFees: 8_200_000_000, holders: 834, stakeStatus: "Returned" },
      { mint: "ghi789", ticker: "$BETA", dailyVolume: 2_100_000_000, dailyFees: 16_800_000, totalFees: 4_400_000_000, holders: 421, stakeStatus: "Escrowed" },
    ] satisfies TokenBreakdown[],
    stakes: [
      { ticker: "$PROVE", status: "Escrowed", deadline: "2026-05-01", amount: 5_000_000_000 },
      { ticker: "$ALPHA", status: "Returned", deadline: "2026-03-15", amount: 3_000_000_000 },
      { ticker: "$BETA", status: "Escrowed", deadline: "2026-06-10", amount: 2_000_000_000 },
    ] satisfies StakeInfo[],
    launches: [
      { ticker: "$PROVE", mint: "abc123", outcome: "succeeded", participants: 342, solRaised: 1_250_000_000_000, date: "2026-03-01" },
      { ticker: "$ALPHA", mint: "def456", outcome: "succeeded", participants: 218, solRaised: 800_000_000_000, date: "2026-02-15" },
      { ticker: "$GAMMA", mint: "jkl012", outcome: "failed", participants: 45, solRaised: 120_000_000_000, date: "2026-01-20" },
    ] satisfies LaunchRecord[],
  };
}

const STAKE_COLORS: Record<string, string> = {
  Escrowed: "badge-warning",
  Returned: "badge-success",
  Forfeited: "badge-danger",
};

/* ── Page ── */

export default function CreatorPage() {
  const { wallet } = useParams<{ wallet: string }>();
  const { activeKey } = useTransaction();
  const { login } = usePrivyWallet();
  const connected = !!activeKey;
  const [withdrawing, setWithdrawing] = useState(false);

  if (!BASE58_RE.test(wallet)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-foreground-muted">Invalid wallet address.</p>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <p className="text-foreground-muted">
          Connect your wallet to view the creator dashboard.
        </p>
        <button className="btn-primary" onClick={login}>
          Connect Wallet
        </button>
      </div>
    );
  }

  const data = getCreatorData();

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setTimeout(() => setWithdrawing(false), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 pb-20">
      {/* ── Earnings Overview ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass-card p-6 lg:p-8 mt-10 bg-gradient-to-br from-primary/5 to-transparent"
      >
        <h2 className="text-lg font-bold text-foreground mb-6">
          Earnings Overview
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
              Total Earned
            </span>
            <span className="block font-mono text-2xl font-bold text-foreground">
              {formatSol(data.totalFees)} SOL
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
              Withdrawn
            </span>
            <span className="block font-mono text-lg font-semibold text-foreground-muted">
              {formatSol(data.totalWithdrawn)} SOL
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
              Pending
            </span>
            <span className="block font-mono text-xl font-bold text-success">
              {formatSol(data.pending)} SOL
            </span>
          </div>
        </div>
        <button
          className="btn-primary"
          disabled={data.pending <= 0 || withdrawing}
          onClick={handleWithdraw}
        >
          {withdrawing ? "Withdrawing..." : "Withdraw All"}
        </button>
      </motion.div>

      {/* ── Token Breakdown ── */}
      <Reveal className="mt-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Token Breakdown
        </h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  {["Token", "Daily Vol", "Daily Fees", "Total Fees", "Holders", "Stake"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-foreground-muted font-mono font-semibold"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.tokens.map((t) => (
                  <tr
                    key={t.mint}
                    className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/token/${t.mint}`}
                        className="font-mono text-primary hover:text-primary-light transition-colors"
                      >
                        {t.ticker}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {formatSol(t.dailyVolume)} SOL
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {formatSol(t.dailyFees)} SOL
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {formatSol(t.totalFees)} SOL
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {t.holders.toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`badge ${STAKE_COLORS[t.stakeStatus] ?? ""}`}>
                        {t.stakeStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      {/* ── Stake Status ── */}
      <Reveal className="mt-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Stake Status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data.stakes.map((s) => (
            <div key={s.ticker} className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-sm font-bold text-foreground">
                  {s.ticker}
                </span>
                <span className={`badge ${STAKE_COLORS[s.status] ?? ""}`}>
                  {s.status}
                </span>
              </div>
              <span className="block font-mono text-lg font-bold text-foreground mb-1">
                {formatSol(s.amount)} SOL
              </span>
              <span className="block text-xs text-foreground-muted">
                Deadline: {s.deadline}
              </span>
            </div>
          ))}
        </div>
      </Reveal>

      {/* ── Launch History ── */}
      <Reveal className="mt-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Launch History
        </h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  {["Token", "Outcome", "Participants", "SOL Raised", "Date"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-foreground-muted font-mono font-semibold"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.launches.map((l) => (
                  <tr
                    key={l.mint}
                    className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/token/${l.mint}`}
                        className="font-mono text-primary hover:text-primary-light transition-colors"
                      >
                        {l.ticker}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`badge ${
                          l.outcome === "succeeded"
                            ? "badge-success"
                            : "badge-danger"
                        }`}
                      >
                        {l.outcome}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {l.participants.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {formatSol(l.solRaised)} SOL
                    </td>
                    <td className="px-5 py-3 font-mono text-foreground-muted">
                      {l.date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
