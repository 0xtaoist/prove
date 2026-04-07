"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion";
import { TradeWidget } from "./TradeWidget";

interface TokenDetailData {
  mint: string;
  ticker: string;
  name: string;
  creatorFull: string;
  shortenedCreator: string;
  badges: Array<{ label: string; variant: string }>;
  price: number;
  change24h: number;
  formattedPrice: string;
  formattedVolume: string;
  formattedMarketCap: string;
  formattedBatchPrice: string;
  formattedCreatorFees: string;
  stats: {
    holders: number;
    volume24h: number;
    marketCap: number;
    avgHoldTime: string;
    batchPrice: number;
  };
  quests: Array<{
    id: string;
    name: string;
    description: string;
    current: number;
    target: number;
    completed: boolean;
    reward: string;
  }>;
  creatorStats: {
    totalFeesEarned: number;
    pastLaunches: number;
    stakeStatus: string;
  };
  holders: Array<{
    wallet: string;
    balance: number;
    holdTime: string;
    pct: string;
  }>;
}

const BADGE_CLASSES: Record<string, string> = {
  primary: "badge-primary",
  success: "badge-success",
  warning: "badge-warning",
};

export function TokenDetailClient({ data }: { data: TokenDetailData }) {
  const isPositive = data.change24h >= 0;

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-6 pb-20">
      {/* ── Token Header ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="pt-10 pb-8 border-b border-border"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-mono">
                {data.ticker}
              </h1>
              <div className="flex gap-1.5">
                {data.badges.map((b) => (
                  <span
                    key={b.label}
                    className={`badge ${BADGE_CLASSES[b.variant] ?? ""}`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-sm text-foreground-muted">{data.name}</p>
            <Link
              href={`/creator/${data.creatorFull}`}
              className="text-xs text-foreground-muted hover:text-primary transition-colors font-mono mt-1 inline-block"
            >
              Creator: {data.shortenedCreator}
            </Link>
          </div>
          <div className="text-right">
            <span className="block font-mono text-xs text-foreground-muted mb-0.5">
              Batch price: {data.formattedBatchPrice} SOL
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── Stats grid ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-border/50 rounded-xl overflow-hidden my-8"
      >
        {[
          {
            label: "Current Price",
            value: `${data.formattedPrice} SOL`,
            extra: (
              <span
                className={`text-xs font-mono font-semibold ${isPositive ? "text-success" : "text-danger"}`}
              >
                {isPositive ? "+" : ""}
                {data.change24h.toFixed(1)}%
              </span>
            ),
          },
          { label: "Holders", value: data.stats.holders.toLocaleString() },
          { label: "24h Volume", value: `${data.formattedVolume} SOL` },
          { label: "Market Cap", value: `${data.formattedMarketCap} SOL` },
          { label: "Avg Hold Time", value: data.stats.avgHoldTime },
        ].map((stat) => (
          <div key={stat.label} className="bg-background-secondary p-5">
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1.5">
              {stat.label}
            </span>
            <span className="block font-mono text-base font-bold text-foreground">
              {stat.value}
            </span>
            {stat.extra}
          </div>
        ))}
      </motion.div>

      {/* ── Trade section ── */}
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 mb-14">
        <Reveal>
          <div className="glass-card p-8 flex items-center justify-center min-h-[300px]">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
                </svg>
              </div>
              <p className="text-foreground-muted text-sm">Chart coming soon</p>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <TradeWidget ticker={data.ticker} mint={data.mint} currentPrice={data.price} />
        </Reveal>
      </div>

      {/* ── Quests ── */}
      <Reveal>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-primary mb-5">
          QUESTS
        </h2>
      </Reveal>
      <StaggerGroup className="space-y-3 mb-14">
        {data.quests.map((q) => {
          const pct = Math.min(100, Math.round((q.current / q.target) * 100));
          return (
            <StaggerItem key={q.id}>
              <div
                className={`glass-card p-5 flex flex-wrap items-center gap-4 ${
                  q.completed ? "border-success/30" : ""
                }`}
              >
                <div className="flex-1 min-w-[200px]">
                  <span className="text-sm font-semibold text-foreground">
                    {q.name}
                  </span>
                  <p className="text-xs text-foreground-muted mt-0.5">
                    {q.description}
                  </p>
                </div>
                <div className="flex items-center gap-3 min-w-[180px]">
                  <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        q.completed
                          ? "bg-gradient-to-r from-success to-success/70"
                          : "bg-gradient-to-r from-primary to-primary-light"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-foreground-muted whitespace-nowrap">
                    {q.current}/{q.target}
                  </span>
                </div>
                <span
                  className={`font-mono text-sm font-bold w-12 text-center ${
                    q.completed ? "text-success" : "text-primary"
                  }`}
                >
                  {q.completed ? "\u2713" : `${pct}%`}
                </span>
              </div>
            </StaggerItem>
          );
        })}
      </StaggerGroup>

      {/* ── Creator ── */}
      <Reveal>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-primary mb-5">
          CREATOR
        </h2>
        <div className="glass-card p-5 grid grid-cols-2 lg:grid-cols-4 gap-5 mb-14">
          {[
            {
              label: "Wallet",
              value: data.shortenedCreator,
              href: `/creator/${data.creatorFull}`,
            },
            { label: "Total Fees Earned", value: `${data.formattedCreatorFees} SOL` },
            { label: "Launches", value: String(data.creatorStats.pastLaunches) },
            { label: "Stake Status", value: data.creatorStats.stakeStatus },
          ].map((s) => (
            <div key={s.label}>
              <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
                {s.label}
              </span>
              {s.href ? (
                <Link
                  href={s.href}
                  className="font-mono text-sm font-semibold text-primary hover:text-primary-light transition-colors"
                >
                  {s.value}
                </Link>
              ) : (
                <span className="font-mono text-sm font-semibold text-foreground">
                  {s.value}
                </span>
              )}
            </div>
          ))}
        </div>
      </Reveal>

      {/* ── Top Holders ── */}
      <Reveal>
        <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-primary mb-5">
          TOP HOLDERS
        </h2>
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50">
                  {["Rank", "Wallet", "Balance", "Hold Time", "% Supply"].map(
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
                {data.holders.map((h, i) => (
                  <tr
                    key={h.wallet}
                    className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-foreground-muted">
                      {i + 1}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/profile/${h.wallet}`}
                        className="font-mono text-foreground hover:text-primary transition-colors"
                      >
                        {h.wallet}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-mono">
                      {h.balance.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 font-mono">{h.holdTime}</td>
                    <td className="px-5 py-3 font-mono text-primary">
                      {h.pct}%
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
