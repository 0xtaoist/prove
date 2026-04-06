"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { motion } from "framer-motion";
import { Reveal } from "@/components/motion";

type AuctionState = "Gathering" | "Succeeded" | "Failed";

interface AuctionData {
  mint: string;
  ticker: string;
  name: string;
  description: string;
  state: AuctionState;
  endsAt: number;
  participants: number;
  solCommitted: number;
  minWallets: number;
  minSol: number;
}

const API_BASE = process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://localhost:4000";
const MIN_COMMITMENT_SOL = 0.1;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

const STATE_BADGE: Record<AuctionState, { label: string; className: string }> = {
  Gathering: { label: "Gathering", className: "badge-warning" },
  Succeeded: { label: "Succeeded", className: "badge-success" },
  Failed: { label: "Failed", className: "badge-danger" },
};

export default function BatchAuctionPage() {
  const params = useParams<{ mint: string }>();
  const mint = params.mint;
  const { connected } = useWallet();

  const [auction, setAuction] = useState<AuctionData | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [commitAmount, setCommitAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isValidMint = BASE58_RE.test(mint);

  const fetchAuction = useCallback(async () => {
    if (!isValidMint) {
      setError("Invalid mint address");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auctions/${encodeURIComponent(mint)}`);
      if (!res.ok) throw new Error("Auction not found");
      const data = await res.json();
      setAuction({
        mint: data.mint,
        ticker: data.ticker,
        name: data.name ?? "",
        description: data.description ?? "",
        state: data.state,
        endsAt: data.ends_at,
        participants: data.participants,
        solCommitted: data.sol_committed,
        minWallets: data.min_wallets ?? 50,
        minSol: data.min_sol ?? 10_000_000_000,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load auction");
    } finally {
      setLoading(false);
    }
  }, [mint, isValidMint]);

  useEffect(() => {
    fetchAuction();
    const interval = setInterval(fetchAuction, 10_000);
    return () => clearInterval(interval);
  }, [fetchAuction]);

  useEffect(() => {
    if (!auction) return;
    const tick = () => setRemaining(auction.endsAt - Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [auction]);

  const handleCommit = () => {
    const amount = parseFloat(commitAmount);
    if (isNaN(amount) || amount < MIN_COMMITMENT_SOL) {
      alert(`Minimum commitment is ${MIN_COMMITMENT_SOL} SOL`);
      return;
    }
    alert(`Would commit ${amount} SOL to auction ${mint}`);
  };

  const handleRefund = () => {
    alert(`Would request refund for auction ${mint}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-foreground-muted">{error ?? "Auction not found"}</p>
      </div>
    );
  }

  const walletProgress = Math.min((auction.participants / auction.minWallets) * 100, 100);
  const solProgress = Math.min((auction.solCommitted / auction.minSol) * 100, 100);
  const badge = STATE_BADGE[auction.state];

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 pb-20">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="pt-10 pb-8 border-b border-border"
      >
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground font-mono">
            ${auction.ticker}
          </h1>
          <span className={`badge ${badge.className} flex items-center gap-1.5`}>
            {auction.state === "Gathering" && (
              <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
            )}
            {badge.label}
          </span>
        </div>
      </motion.div>

      {/* Countdown */}
      {auction.state === "Gathering" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center py-10"
        >
          <span className="font-mono text-5xl lg:text-6xl font-bold text-accent-gold">
            {formatCountdown(remaining)}
          </span>
        </motion.div>
      )}

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid grid-cols-3 gap-3 my-8"
      >
        {[
          { label: "Participants", value: String(auction.participants) },
          { label: "SOL Committed", value: formatSol(auction.solCommitted) },
          { label: "State", value: auction.state },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-5 text-center">
            <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1.5">
              {stat.label}
            </span>
            <span className="block font-mono text-xl font-bold text-foreground">
              {stat.value}
            </span>
          </div>
        ))}
      </motion.div>

      {/* Progress Bars */}
      <Reveal className="space-y-5 mb-10">
        {[
          {
            label: `Wallets (${auction.participants} / ${auction.minWallets})`,
            pct: walletProgress,
          },
          {
            label: `SOL (${formatSol(auction.solCommitted)} / ${formatSol(auction.minSol)})`,
            pct: solProgress,
          },
        ].map((bar) => (
          <div key={bar.label}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-foreground-muted">{bar.label}</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                {Math.round(bar.pct)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  bar.pct >= 100
                    ? "bg-gradient-to-r from-success to-success/70"
                    : "bg-gradient-to-r from-primary to-primary-light"
                }`}
                style={{ width: `${bar.pct}%` }}
              />
            </div>
          </div>
        ))}
      </Reveal>

      {/* Commit Section */}
      {auction.state === "Gathering" && (
        <Reveal>
          <div className="glass-card p-6">
            <h3 className="text-base font-semibold text-foreground mb-4">
              Commit SOL
            </h3>
            <div className="flex gap-3 mb-3">
              <input
                type="number"
                className="input font-mono flex-1"
                placeholder="0.00"
                min={MIN_COMMITMENT_SOL}
                step="0.1"
                value={commitAmount}
                onChange={(e) => setCommitAmount(e.target.value)}
              />
              <button
                className="btn-primary whitespace-nowrap"
                disabled={!connected}
                onClick={handleCommit}
              >
                {connected ? "Commit" : "Connect Wallet"}
              </button>
            </div>
            <p className="text-xs text-foreground-muted">
              Minimum commitment:{" "}
              <span className="font-mono font-semibold">
                {MIN_COMMITMENT_SOL} SOL
              </span>
            </p>
          </div>
        </Reveal>
      )}

      {/* Succeeded */}
      {auction.state === "Succeeded" && (
        <Reveal>
          <div className="glass-card p-8 text-center border-success/30">
            <h2 className="text-xl font-bold text-success mb-3">
              Auction Succeeded
            </h2>
            <p className="text-foreground-muted">
              ${auction.ticker} launched successfully with{" "}
              {auction.participants} participants and{" "}
              {formatSol(auction.solCommitted)} SOL committed. Tokens have been
              distributed to all participants.
            </p>
          </div>
        </Reveal>
      )}

      {/* Failed */}
      {auction.state === "Failed" && (
        <Reveal>
          <div className="glass-card p-8 text-center">
            <h2 className="text-xl font-bold text-danger mb-3">
              Auction Failed
            </h2>
            <p className="text-foreground-muted mb-6">
              This auction did not meet the minimum requirements. You can claim a
              refund for any SOL you committed.
            </p>
            <button
              className="btn-primary"
              disabled={!connected}
              onClick={handleRefund}
            >
              {connected ? "Claim Refund" : "Connect Wallet to Refund"}
            </button>
          </div>
        </Reveal>
      )}
    </div>
  );
}
