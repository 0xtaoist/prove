"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Reveal,
  AnimatedNumber,
  staggerContainer,
  staggerItem,
} from "@/components/motion";

/* ── SVG Icons ── */

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

export default function HowItWorksPage() {
  return (
    <div className="relative bg-[#050507] min-h-screen">
      {/* ── Header ── */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 pt-16 pb-12 border-b border-white/10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-zinc-600 hover:text-zinc-400 text-xs font-mono transition-colors mb-8"
          >
            <span>←</span>
            <span>back</span>
          </Link>
          <h1 className="text-3xl lg:text-5xl font-bold text-white tracking-tight mb-4">
            how it works.
          </h1>
          <p className="text-zinc-500 text-base lg:text-lg font-mono max-w-lg">
            six mechanics that change the game. no bots, no bundlers, no rugs.
          </p>
        </motion.div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8">
        <StaggerGroup className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <StaggerItem
              key={f.title}
              className={`group p-8 border-b border-white/10 ${
                i % 3 !== 2 ? "lg:border-r" : ""
              } ${i % 2 !== 1 ? "md:border-r lg:border-r-0" : "md:border-r-0"} ${
                i % 3 !== 2 ? "lg:border-r" : ""
              } transition-colors duration-300 hover:bg-white/[0.02]`}
            >
              <div className="w-10 h-10 border border-white/10 flex items-center justify-center text-white/60 mb-5 group-hover:border-white/20 group-hover:text-white/80 transition-all duration-300">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-white mb-2 font-mono">
                {f.title}
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {f.desc}
              </p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </section>

      {/* ── Flywheel ── */}
      <section className="border-t border-white/10 mt-0">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <Reveal className="py-12">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-600 mb-3 block">
              THE FLYWHEEL
            </span>
            <h2 className="text-xl lg:text-2xl font-bold text-white mb-10">
              every mechanic feeds the next.
            </h2>

            <div className="overflow-x-auto">
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="flex items-center gap-0 min-w-max"
              >
                {FLYWHEEL_STEPS.map((step, i) => (
                  <motion.div
                    key={step}
                    variants={staggerItem}
                    className="flex items-center"
                  >
                    <div className="flex flex-col items-center text-center px-5">
                      <span className="font-mono text-[10px] font-bold text-zinc-600 mb-2">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="w-12 h-12 border border-white/10 flex items-center justify-center mb-3 hover:border-white/20 transition-colors">
                        <span className="text-sm font-bold text-white/60 font-mono">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <span className="text-xs font-medium text-zinc-400 whitespace-nowrap font-mono">
                        {step}
                      </span>
                    </div>
                    {i < FLYWHEEL_STEPS.length - 1 && (
                      <span className="text-zinc-700 text-sm">→</span>
                    )}
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-t border-white/10">
        <StaggerGroup className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <StaggerItem
              key={s.value}
              className={`p-8 ${i < 3 ? "border-r border-white/10" : ""} ${
                i < 2 ? "border-b lg:border-b-0 border-white/10" : ""
              }`}
            >
              <AnimatedNumber
                value={s.value}
                className="block font-mono text-xl lg:text-2xl font-bold text-white mb-2"
              />
              <span className="text-xs text-zinc-600 leading-snug block">
                {s.label}
              </span>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-white/10">
        <Reveal className="max-w-5xl mx-auto px-6 lg:px-8 py-16 lg:py-24 text-center">
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-4">
            ready to prove it?
          </h2>
          <p className="text-zinc-500 mb-8 font-mono text-sm">
            launch your token with a fair start.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/launch"
              className="group inline-flex items-center justify-center gap-2 px-7 py-3 bg-white text-zinc-950 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              start building
              <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
              </svg>
            </Link>
            <Link
              href="/discover"
              className="inline-flex items-center justify-center gap-2 px-7 py-3 border border-white/20 text-white text-sm font-semibold transition-all duration-200 hover:bg-white/5"
            >
              explore tokens
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
