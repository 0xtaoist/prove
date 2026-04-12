"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";
import { ProveScoreRing } from "@/components/ProveScoreRing";

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

interface ProfileData {
  wallet: string;
  proveScore: number;
  breakdown: {
    totalHoldTime: string;
    auctionsParticipated: number;
    questContributions: number;
    earlyDumpRatio: number;
  };
  lastActive: string;
  scoreDecay: string;
  holdings: Array<{
    mint: string;
    ticker: string;
    balance: number;
    pnl: number;
    holdDuration: string;
  }>;
  auctions: Array<{
    id: string;
    token: string;
    mint: string;
    outcome: "succeeded" | "failed";
    tokensClaimed: number;
    solCommitted: number;
    date: string;
  }>;
}

export function ProfileClient({ data }: { data: ProfileData }) {
  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-6 pb-20">
      {/* ── Score Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col sm:flex-row items-center gap-6 pt-12 pb-10 border-b border-border"
      >
        <ProveScoreRing score={data.proveScore} size={140} />
        <div className="text-center sm:text-left">
          <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
            Wallet
          </span>
          <span className="block font-mono text-lg font-semibold text-foreground">
            {shortenAddress(data.wallet)}
          </span>
        </div>
      </motion.div>

      {/* ── Score Breakdown ── */}
      <Reveal className="mt-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Score Breakdown
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Total Hold Time", value: data.breakdown.totalHoldTime },
            { label: "Auctions", value: String(data.breakdown.auctionsParticipated) },
            { label: "Quest Contributions", value: String(data.breakdown.questContributions) },
            {
              label: "Early Dump Ratio",
              value: `${(data.breakdown.earlyDumpRatio * 100).toFixed(1)}%`,
              color:
                data.breakdown.earlyDumpRatio > 0.3
                  ? "text-danger"
                  : data.breakdown.earlyDumpRatio > 0.15
                    ? "text-warning"
                    : "text-success",
            },
          ].map((item) => (
            <div key={item.label} className="glass-card p-4">
              <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
                {item.label}
              </span>
              <span
                className={`block font-mono text-lg font-bold ${
                  item.color ?? "text-foreground"
                }`}
              >
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </Reveal>

      {/* ── Stats ── */}
      <Reveal className="mt-8">
        <div className="flex flex-wrap gap-6 glass-card p-5">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
              Last Active
            </span>
            <span className="font-mono text-sm text-foreground">
              {data.lastActive}
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
              Score Decay
            </span>
            <span className="font-mono text-sm text-foreground">
              {data.scoreDecay}
            </span>
          </div>
        </div>
      </Reveal>

      {/* ── Token Holdings ── */}
      <Reveal className="mt-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Token Holdings
        </h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  {["Token", "Balance", "Unrealized PnL", "Hold Duration"].map((h) => (
                    <th
                      key={h}
                      className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-foreground-muted font-mono font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.mint} className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/token/${h.mint}`} className="font-mono text-primary hover:text-primary-light transition-colors">
                        {h.ticker}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono">{h.balance.toLocaleString()}</td>
                    <td className={`px-5 py-3 font-mono font-semibold ${h.pnl >= 0 ? "text-success" : "text-danger"}`}>
                      {h.pnl >= 0 ? "+" : ""}{formatSol(h.pnl)} SOL
                    </td>
                    <td className="px-5 py-3 font-mono text-foreground-muted">{h.holdDuration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>

      {/* ── Auction History ── */}
      <Reveal className="mt-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Auction History
        </h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  {["Token", "SOL Committed", "Tokens Claimed", "Outcome", "Date"].map((h) => (
                    <th
                      key={h}
                      className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-foreground-muted font-mono font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.auctions.map((a) => (
                  <tr key={a.id} className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/token/${a.mint}`} className="font-mono text-primary hover:text-primary-light transition-colors">
                        {a.token}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono">{formatSol(a.solCommitted)} SOL</td>
                    <td className="px-5 py-3 font-mono">{a.tokensClaimed.toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${a.outcome === "succeeded" ? "badge-success" : "badge-danger"}`}>
                        {a.outcome}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-foreground-muted">{a.date}</td>
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
