"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Reveal,
  StaggerGroup,
  StaggerItem,
  AnimatedNumber,
  staggerContainer,
  staggerItem,
} from "@/components/motion";

/* ── SVG Icons (replacing emojis) ── */

const icons = {
  timer: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  bolt: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  refresh: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
    </svg>
  ),
  diamond: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
    </svg>
  ),
  trending: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  star: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

const FEATURES = [
  {
    icon: icons.timer,
    title: "fair start",
    desc: "5-minute batch auction. every wallet gets the same price. no front-running, no sniping.",
  },
  {
    icon: icons.bolt,
    title: "skin in the game",
    desc: "deployers stake 2 SOL. refunded only if the token hits 100 holders. aligned incentives from day one.",
  },
  {
    icon: icons.refresh,
    title: "creators earn daily",
    desc: "0.8% of every trade goes to the creator. build community, get paid. every single day.",
  },
  {
    icon: icons.diamond,
    title: "the 1% fee",
    desc: "most creator-friendly split in the market. low enough to trade, high enough to sustain.",
  },
  {
    icon: icons.trending,
    title: "signal over noise",
    desc: "the feed only shows tokens that survived. no dead launches cluttering your screen.",
  },
  {
    icon: icons.star,
    title: "prove score",
    desc: "wallet reputation that rewards holding. diamond hands get priority. flippers get filtered.",
  },
];

const FLYWHEEL_STEPS = [
  "creator stakes",
  "batch auction",
  "fair price",
  "trading begins",
  "creator earns",
  "community grows",
  "cycle repeats",
];

const STATS = [
  { value: "$400/day", label: "$50K volume = $400/day for creators" },
  { value: "98.6%", label: "of pump.fun tokens rug" },
  { value: "50 wallets", label: "minimum per batch auction" },
  { value: "72 hrs", label: "milestone window for deployer refund" },
];

export default function LandingPage() {
  return (
    <div className="relative">
      {/* ═══ Hero Section ═══ */}
      <section className="relative overflow-hidden">
        {/* Animated gradient background */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] animate-pulse-glow" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-accent-gold/5 rounded-full blur-[100px] animate-pulse-glow" style={{ animationDelay: "1s" }} />
          <div className="absolute inset-0 grid-pattern" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 lg:px-6 pt-20 pb-24 lg:pt-32 lg:pb-36">
          {/* Kicker badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono font-semibold tracking-wider mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              BUILT ON SOLANA
            </span>
          </motion.div>

          {/* Main heading */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-4xl sm:text-5xl lg:text-7xl font-bold leading-[1.05] tracking-tight max-w-4xl mb-6"
          >
            <span className="text-foreground">coins that stick.</span>
            <br />
            <span className="gradient-text">creators that stay.</span>
            <br />
            <span className="text-foreground">communities that hold.</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="text-lg text-foreground-muted max-w-xl mb-10 leading-relaxed"
          >
            The launchpad where everyone gets the same price. No bots. No
            bundlers. Creators earn by building.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="flex flex-wrap gap-4 mb-14"
          >
            <Link href="/launch" className="btn-primary text-base px-8 py-4 group">
              launch a token
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
            <Link href="/discover" className="btn-outline text-base px-8 py-4">
              explore tokens
            </Link>
          </motion.div>

          {/* Mini stats bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex flex-wrap items-center gap-0"
          >
            {[
              "50+ wallets per batch",
              "0.8% to creators",
              "5-min fair start",
            ].map((stat, i) => (
              <span
                key={stat}
                className={`font-mono text-xs text-foreground-muted py-1 ${
                  i < 2
                    ? "pr-5 mr-5 border-r border-border"
                    : ""
                }`}
              >
                {stat}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ Features Section ═══ */}
      <section className="relative border-t border-border">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          {/* Section header */}
          <Reveal className="py-12 lg:py-16 border-b border-border">
            <span className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-primary mb-3 block">
              HOW IT WORKS
            </span>
            <h2 className="text-2xl lg:text-4xl font-bold text-foreground">
              six mechanics that change the game.
            </h2>
          </Reveal>

          {/* Features grid */}
          <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <StaggerItem
                key={f.title}
                className={`group p-8 lg:p-10 border-b border-border ${
                  i % 3 !== 2 ? "lg:border-r" : ""
                } ${i % 2 !== 1 ? "md:border-r lg:border-r-0" : "md:border-r-0"} ${
                  i % 3 !== 2 ? "lg:border-r" : ""
                } transition-colors duration-300 hover:bg-card/30`}
              >
                <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-5 group-hover:bg-primary/20 group-hover:border-primary/30 transition-all duration-300 group-hover:scale-110">
                  {f.icon}
                </div>
                <h3 className="text-base font-semibold text-foreground mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-foreground-muted leading-relaxed">
                  {f.desc}
                </p>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </div>
      </section>

      {/* ═══ Flywheel Section ═══ */}
      <section className="relative border-t border-border bg-background-secondary/50">
        <div className="max-w-6xl mx-auto px-4 lg:px-6">
          <Reveal className="py-12 lg:py-16 border-b border-border">
            <span className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-accent-gold mb-3 block">
              THE FLYWHEEL
            </span>
            <h2 className="text-2xl lg:text-4xl font-bold text-foreground">
              every mechanic feeds the next.
            </h2>
          </Reveal>

          <div className="py-12 lg:py-16 overflow-x-auto">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="flex items-center gap-0 min-w-max mx-auto justify-center"
            >
              {FLYWHEEL_STEPS.map((step, i) => (
                <motion.div
                  key={step}
                  variants={staggerItem}
                  className="flex items-center"
                >
                  <div className="flex flex-col items-center text-center px-4 lg:px-6 group">
                    <span className="font-mono text-xs font-bold text-primary mb-2 opacity-60">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="w-14 h-14 rounded-xl bg-card border border-border flex items-center justify-center mb-3 group-hover:border-primary/40 group-hover:bg-primary/5 transition-all duration-300">
                      <span className="text-lg font-bold text-primary">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-foreground whitespace-nowrap">
                      {step}
                    </span>
                  </div>
                  {i < FLYWHEEL_STEPS.length - 1 && (
                    <div className="flex items-center px-1">
                      <svg className="w-5 h-5 text-foreground-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M5 12h14m-7-7 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══ Stats Section ═══ */}
      <section className="border-t border-border">
        <StaggerGroup className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <StaggerItem
              key={s.value}
              className={`p-8 lg:p-10 ${
                i < 3 ? "border-r border-border" : ""
              } ${i < 2 ? "border-b lg:border-b-0 border-border" : ""}`}
            >
              <AnimatedNumber
                value={s.value}
                className="block font-mono text-2xl lg:text-3xl font-bold text-primary-light mb-2"
              />
              <span className="text-sm text-foreground-muted leading-snug block">
                {s.label}
              </span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </section>

      {/* ═══ CTA Section ═══ */}
      <section className="relative border-t border-border overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary-dark to-primary" />
        <div className="absolute inset-0 dot-pattern opacity-30" />

        <Reveal className="relative max-w-6xl mx-auto px-4 lg:px-6 py-20 lg:py-28 text-center">
          <h2 className="text-3xl lg:text-5xl font-bold text-white mb-4">
            ready to prove it?
          </h2>
          <p className="text-lg text-white/70 mb-10 max-w-md mx-auto">
            launch your token with a fair start.
          </p>
          <Link
            href="/launch"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-lg bg-background text-primary-hover font-semibold text-base hover:bg-white transition-all duration-200 hover:shadow-lg hover:shadow-black/20 active:scale-[0.98]"
          >
            start building
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </Reveal>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 lg:px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-mono text-xs text-foreground-muted tracking-wider">
            PROVE &copy; 2026
          </span>
          <div className="flex items-center gap-6">
            <Link href="/discover" className="text-sm text-foreground-muted hover:text-foreground transition-colors">
              discover
            </Link>
            <Link href="/launch" className="text-sm text-foreground-muted hover:text-foreground transition-colors">
              launch
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
