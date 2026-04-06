"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Reveal, StaggerGroup, StaggerItem } from "@/components/motion";
import { AuctionRow } from "@/components/AuctionRow";
import type { AuctionRowProps } from "@/components/AuctionRow";
import { TokenRow } from "@/components/TokenRow";
import type { TokenRowProps } from "@/components/TokenRow";

interface DiscoverClientProps {
  auctions: AuctionRowProps[];
  tokens: TokenRowProps[];
}

export function DiscoverClient({ auctions, tokens }: DiscoverClientProps) {
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-6 pb-20">
      {/* ── Page header ── */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="pt-10 pb-8 border-b border-border"
      >
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-primary mb-3 block">
          DISCOVER
        </span>
        <h1 className="text-3xl lg:text-4xl font-bold text-foreground mb-2">
          tokens that proved themselves.
        </h1>
        <p className="text-foreground-muted">
          Only surviving tokens appear here. No noise.
        </p>
      </motion.section>

      {/* ── Auctions section ── */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mt-10"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-foreground">
              LIVE AUCTIONS
            </h2>
            <span className="badge badge-primary">{auctions.length}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            gathering now
          </div>
        </div>

        <div className="space-y-2">
          {auctions.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-foreground-muted">
                no active auctions right now.
              </p>
            </div>
          ) : (
            <StaggerGroup className="space-y-2">
              {auctions.map((a) => (
                <StaggerItem key={a.mint}>
                  <AuctionRow {...a} />
                </StaggerItem>
              ))}
            </StaggerGroup>
          )}
        </div>
      </motion.section>

      {/* ── Token feed section ── */}
      <section className="mt-14">
        <Reveal>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-foreground">
              TOKEN FEED
            </h2>
            <div className="flex items-center gap-1">
              {["holders", "volume", "hold time", "score"].map((label, i) => (
                <button
                  key={label}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                    i === 0
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-foreground-muted hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Reveal>

        <div className="space-y-2">
          {tokens.length === 0 ? (
            <Reveal>
              <div className="glass-card p-12 text-center">
                <p className="text-foreground-muted mb-4">
                  no tokens yet. be first to launch.
                </p>
                <Link href="/launch" className="btn-primary">
                  launch a token
                </Link>
              </div>
            </Reveal>
          ) : (
            <StaggerGroup className="space-y-2">
              {tokens.map((t) => (
                <StaggerItem key={t.mint}>
                  <TokenRow {...t} />
                </StaggerItem>
              ))}
            </StaggerGroup>
          )}
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <Reveal className="mt-16">
        <div className="glass-card p-8 lg:p-12 text-center bg-gradient-to-br from-primary/5 to-transparent">
          <p className="text-foreground-muted mb-4 max-w-lg mx-auto">
            launch through a batch auction. if 50+ wallets join and 10+ SOL is
            committed, your token goes live.
          </p>
          <Link href="/launch" className="btn-primary group">
            launch a token
            <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
