"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export interface AuctionRowProps {
  mint: string;
  ticker: string;
  endTime: number;
  participants: number;
  solCommitted: number;
  minWallets: number;
  minSol: number;
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
  minSol: _minSol,
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
    <Link
      href={`/batch/${mint}`}
      className="glass-card flex flex-wrap items-center gap-4 lg:gap-6 p-4 lg:p-5 group"
    >
      {/* Ticker */}
      <div className="flex items-center gap-2.5 min-w-[100px]">
        <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
        <span className="font-mono text-sm font-semibold text-foreground">
          ${ticker}
        </span>
      </div>

      {/* Countdown */}
      <div className="min-w-[60px]">
        <span
          className={`font-mono text-sm font-bold ${
            ended ? "text-foreground-muted" : "text-accent-gold"
          }`}
        >
          {ended ? "ended" : formatCountdown(remaining)}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-5 flex-1">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
            wallets
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {participants}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
            committed
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatSol(solCommitted)} SOL
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3 min-w-[160px]">
        <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary-light transition-all duration-500"
            style={{ width: `${walletProgress}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-foreground-muted whitespace-nowrap">
          {participants}/{minWallets}
        </span>
      </div>

      {/* Action */}
      <span className="text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200 hidden lg:block">
        commit &rarr;
      </span>
    </Link>
  );
}
