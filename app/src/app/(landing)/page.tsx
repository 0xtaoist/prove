"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

/* ── ASCII Sisyphus Art ── */

const SISYPHUS_ART = `
                                          ·
                                        · · ·
                                      · · · · ·
                                    · · · · · · ·
                                  · · · · · · · · ·
                                · · · · · · · · · · ·
                              · · · · · · · · · · · · ·
                            · · · · · · · · · · · · · · ·
                          ·   · · · · · · · · · · · ·   ·
                        ·       · · · · · · · · · ·       ·
                      ·           · · · · · · · ·           ·
                    ·               · · · · · ·               ·
                                      · · · ·
                                       ╱│╲
                                      ╱ │ ╲
                                     ╱  │  ╲
                                        │
                                       ╱ ╲
                                      ╱   ╲
                               ──────╱─────╲──────
                                   ╱         ╲
                                 ╱             ╲
                               ╱                 ╲
                             ╱                     ╲
                           ╱                         ╲
`;

/* ── Stats for glassmorphic card ── */

const STATS = [
  { value: "1%", label: "total fee" },
  { value: "0.8%", label: "to creators" },
  { value: "5 min", label: "fair start" },
];

/* ── Live indicator dots ── */

function PulseDots() {
  return (
    <div className="flex gap-1">
      <div className="w-1 h-1 bg-white/60 rounded-full animate-pulse" />
      <div className="w-1 h-1 bg-white/40 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
      <div className="w-1 h-1 bg-white/20 rounded-full animate-pulse" style={{ animationDelay: "0.4s" }} />
    </div>
  );
}

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="relative h-[100dvh] -mt-16 overflow-hidden bg-[#050507]">
      {/* ── Stars background ── */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: [
            "radial-gradient(1px 1px at 15% 25%, white, transparent)",
            "radial-gradient(1px 1px at 55% 65%, white, transparent)",
            "radial-gradient(1px 1px at 85% 15%, white, transparent)",
            "radial-gradient(1px 1px at 35% 85%, white, transparent)",
            "radial-gradient(1px 1px at 70% 45%, white, transparent)",
            "radial-gradient(1px 1px at 25% 55%, white, transparent)",
            "radial-gradient(1px 1px at 90% 75%, white, transparent)",
            "radial-gradient(1px 1px at 45% 35%, white, transparent)",
          ].join(", "),
          backgroundSize: "200% 200%, 180% 180%, 250% 250%, 220% 220%, 190% 190%, 240% 240%, 210% 210%, 230% 230%",
        }}
      />

      {/* ── Subtle gradient orb ── */}
      <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] rounded-full opacity-[0.04] blur-[100px] bg-purple-500 pointer-events-none" />

      {/* ── Corner frame accents ── */}
      <div className="absolute top-0 left-0 w-8 h-8 lg:w-10 lg:h-10 border-t border-l border-white/20 z-20" />
      <div className="absolute top-0 right-0 w-8 h-8 lg:w-10 lg:h-10 border-t border-r border-white/20 z-20" />
      <div className="absolute bottom-0 left-0 w-8 h-8 lg:w-10 lg:h-10 border-b border-l border-white/20 z-20" />
      <div className="absolute bottom-0 right-0 w-8 h-8 lg:w-10 lg:h-10 border-b border-r border-white/20 z-20" />

      {/* ── Main content ── */}
      <div className="relative z-10 h-full flex flex-col">
        {/* ── Content area ── */}
        <div className="flex-1 flex items-center">
          <div className="w-full max-w-7xl mx-auto px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">

              {/* ── Left: ASCII Art (desktop only) ── */}
              <div className="hidden lg:block lg:col-span-5">
                <motion.pre
                  initial={{ opacity: 0 }}
                  animate={{ opacity: mounted ? 0.5 : 0 }}
                  transition={{ duration: 2, delay: 0.5 }}
                  className="text-white font-mono text-[7px] xl:text-[8px] leading-[1.2] select-none whitespace-pre"
                  aria-hidden="true"
                >
                  {SISYPHUS_ART}
                </motion.pre>
              </div>

              {/* ── Right: Hero content ── */}
              <div className="lg:col-span-7 flex flex-col space-y-6 lg:space-y-8">
                {/* Decorative line */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.4 }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="flex items-center gap-2"
                >
                  <div className="w-8 h-px bg-white" />
                  <span className="text-white text-[10px] font-mono tracking-wider">◇</span>
                  <div className="flex-1 h-px bg-white/20" />
                </motion.div>

                {/* Headline */}
                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.3 }}
                  className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight leading-[0.95]"
                >
                  <span className="text-white">coins that</span>
                  <br />
                  <span className="bg-gradient-to-r from-white via-white to-purple-300 bg-clip-text text-transparent">
                    stick.
                  </span>
                </motion.h1>

                {/* Description */}
                <motion.p
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.5 }}
                  className="max-w-md text-sm sm:text-base text-zinc-500 leading-relaxed font-mono"
                >
                  fair-launch tokens with batch auctions.
                  <br />
                  creators earn by building. not by rugging.
                </motion.p>

                {/* CTAs */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.65 }}
                  className="flex flex-col sm:flex-row gap-3"
                >
                  <Link
                    href="/launch"
                    className="group inline-flex items-center justify-center gap-2 px-7 py-3 bg-white text-zinc-950 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    launch a token
                    <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                    </svg>
                  </Link>
                  <Link
                    href="/discover"
                    className="inline-flex items-center justify-center gap-2 px-7 py-3 border border-white/20 text-white text-sm font-semibold transition-all duration-200 hover:bg-white/5 hover:border-white/30"
                  >
                    discover tokens
                  </Link>
                </motion.div>

                {/* Glassmorphic stats card */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.85 }}
                  className="relative overflow-hidden border border-white/10 bg-white/[0.03] backdrop-blur-xl p-5 max-w-sm"
                >
                  <div className="absolute top-0 right-0 -mr-10 -mt-10 h-32 w-32 rounded-full bg-white/5 blur-2xl pointer-events-none" />
                  <div className="relative z-10">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      {STATS.map((s) => (
                        <div key={s.label} className="flex flex-col items-center">
                          <span className="text-lg sm:text-xl font-bold text-white font-mono">
                            {s.value}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono mt-0.5">
                            {s.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>

                {/* How it works link */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 1.05 }}
                >
                  <Link
                    href="/how-it-works"
                    className="inline-flex items-center gap-2 text-zinc-600 hover:text-zinc-400 text-xs font-mono transition-colors"
                  >
                    <span>how it works</span>
                    <span className="text-[10px]">→</span>
                  </Link>
                </motion.div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.2 }}
          className="border-t border-white/10 bg-black/30 backdrop-blur-sm"
        >
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4 text-[9px] font-mono text-white/30">
              <span>PROVE.PROTOCOL</span>
              <div className="hidden sm:flex gap-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-white/20"
                    style={{ height: `${Math.floor(4 + Math.sin(i * 1.2) * 4 + 4)}px` }}
                  />
                ))}
              </div>
              <span>SOLANA</span>
            </div>
            <div className="flex items-center gap-3 text-[9px] font-mono text-white/30">
              <span className="hidden sm:inline">◇ BATCH.AUCTION</span>
              <PulseDots />
              <span>LIVE</span>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
