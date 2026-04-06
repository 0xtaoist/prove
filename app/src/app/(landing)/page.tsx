"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  ArrowRight,
  Shield,
  Crown,
  Zap,
  Users,
  TrendingUp,
  Timer,
} from "lucide-react";

/* ── Solana ecosystem marquee brands ── */

const BRANDS = [
  { name: "Phantom", icon: Shield },
  { name: "Jupiter", icon: Zap },
  { name: "Tensor", icon: TrendingUp },
  { name: "Marinade", icon: Crown },
  { name: "Jito", icon: Timer },
  { name: "Helius", icon: Users },
];

/* ── Sub-components ── */

const StatItem = ({ value, label }: { value: string; label: string }) => (
  <div className="flex flex-col items-center justify-center transition-transform hover:-translate-y-1 cursor-default">
    <span className="text-xl font-bold text-white sm:text-2xl">{value}</span>
    <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium sm:text-xs">
      {label}
    </span>
  </div>
);

/* ── UnicornStudio Sisyphus loader ── */

function useSisyphusCanvas() {
  useEffect(() => {
    const embedScript = document.createElement("script");
    embedScript.type = "text/javascript";
    embedScript.textContent = `
      !function(){
        if(!window.UnicornStudio){
          window.UnicornStudio={isInitialized:!1};
          var i=document.createElement("script");
          i.src="https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.33/dist/unicornStudio.umd.js";
          i.onload=function(){
            window.UnicornStudio.isInitialized||(UnicornStudio.init(),window.UnicornStudio.isInitialized=!0)
          };
          (document.head || document.body).appendChild(i)
        }
      }();
    `;
    document.head.appendChild(embedScript);

    const style = document.createElement("style");
    style.textContent = `
      [data-us-project] { position: relative !important; overflow: hidden !important; }
      [data-us-project] canvas { clip-path: inset(0 0 10% 0) !important; }
      [data-us-project] * { pointer-events: none !important; }
      [data-us-project] a[href*="unicorn"],
      [data-us-project] button[title*="unicorn"],
      [data-us-project] div[title*="Made with"],
      [data-us-project] [class*="brand"],
      [data-us-project] [class*="credit"],
      [data-us-project] [class*="watermark"] {
        display: none !important; visibility: hidden !important;
        opacity: 0 !important; position: absolute !important;
        left: -9999px !important; top: -9999px !important;
      }
    `;
    document.head.appendChild(style);

    const hideBranding = () => {
      document
        .querySelectorAll("[data-us-project], [data-us-project] *")
        .forEach((el) => {
          const t = (el.textContent || "").toLowerCase();
          const h = (el.getAttribute("href") || "").toLowerCase();
          if (
            t.includes("made with") ||
            t.includes("unicorn") ||
            h.includes("unicorn.studio")
          ) {
            (el as HTMLElement).style.display = "none";
            try { el.remove(); } catch {}
          }
        });
    };
    hideBranding();
    const iv = setInterval(hideBranding, 50);
    setTimeout(hideBranding, 1000);
    setTimeout(hideBranding, 5000);

    return () => {
      clearInterval(iv);
      try {
        document.head.removeChild(embedScript);
        document.head.removeChild(style);
      } catch {}
    };
  }, []);
}

/* ═══════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════ */

export default function LandingPage() {
  useSisyphusCanvas();

  return (
    <div className="relative w-full bg-black text-white overflow-hidden font-sans h-[100dvh] -mt-16">
      {/* ── Scoped animations ── */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .animate-fade-in {
          animation: fadeSlideIn 0.8s ease-out forwards;
          opacity: 0;
        }
        .animate-marquee {
          animation: marquee 40s linear infinite;
        }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-400 { animation-delay: 0.4s; }
        .delay-500 { animation-delay: 0.5s; }
        .delay-600 { animation-delay: 0.6s; }
        .stars-bg {
          background-image:
            radial-gradient(1px 1px at 20% 30%, white, transparent),
            radial-gradient(1px 1px at 60% 70%, white, transparent),
            radial-gradient(1px 1px at 85% 15%, white, transparent),
            radial-gradient(1px 1px at 35% 85%, white, transparent),
            radial-gradient(1px 1px at 70% 45%, white, transparent),
            radial-gradient(1px 1px at 25% 55%, white, transparent);
          background-size: 200% 200%, 180% 180%, 250% 250%, 220% 220%, 190% 190%, 240% 240%;
          opacity: 0.25;
        }
      `}</style>

      {/* ── Sisyphus canvas (desktop) ── */}
      <div className="absolute inset-0 w-full h-full hidden lg:block">
        <div
          data-us-project="OMzqyUv6M3kSnv0JeAtC"
          style={{ width: "100%", height: "100%", minHeight: "100vh" }}
        />
      </div>

      {/* ── Stars fallback (mobile) ── */}
      <div className="absolute inset-0 w-full h-full lg:hidden stars-bg" />

      {/* ── Corner frame accents ── */}
      <div className="absolute top-0 left-0 w-8 h-8 lg:w-10 lg:h-10 border-t border-l border-white/20 z-20" />
      <div className="absolute top-0 right-0 w-8 h-8 lg:w-10 lg:h-10 border-t border-r border-white/20 z-20" />
      <div className="absolute bottom-16 left-0 w-8 h-8 lg:w-10 lg:h-10 border-b border-l border-white/20 z-20" />
      <div className="absolute bottom-16 right-0 w-8 h-8 lg:w-10 lg:h-10 border-b border-r border-white/20 z-20" />

      {/* ═══ Main content ═══ */}
      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-1 flex items-center">
          <div className="relative z-10 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 pt-16">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8 items-start">
              {/* ── LEFT COLUMN: Hero text ── */}
              <div className="lg:col-span-7 flex flex-col justify-center space-y-7 pt-4 lg:pt-8">
                {/* Badge */}
                <div className="animate-fade-in delay-100">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-md transition-colors hover:bg-white/10">
                    <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                      Built on Solana
                      <Zap className="w-3.5 h-3.5 text-purple-400 fill-purple-400" />
                    </span>
                  </div>
                </div>

                {/* Heading */}
                <h1
                  className="animate-fade-in delay-200 text-4xl sm:text-5xl lg:text-7xl xl:text-8xl font-medium tracking-tighter leading-[0.9]"
                  style={{
                    maskImage:
                      "linear-gradient(180deg, black 0%, black 80%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(180deg, black 0%, black 80%, transparent 100%)",
                  }}
                >
                  coins that
                  <br />
                  <span className="bg-gradient-to-br from-white via-white to-purple-300 bg-clip-text text-transparent">
                    stick.
                  </span>
                </h1>

                {/* Description */}
                <p className="animate-fade-in delay-300 max-w-xl text-base sm:text-lg text-zinc-400 leading-relaxed">
                  The launchpad where everyone gets the same price. No bots. No
                  bundlers. Creators earn by building.
                </p>

                {/* CTA Buttons */}
                <div className="animate-fade-in delay-400 flex flex-col sm:flex-row gap-3">
                  <Link
                    href="/launch"
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-zinc-950 transition-all hover:scale-[1.02] hover:bg-zinc-200 active:scale-[0.98]"
                  >
                    launch a token
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </Link>

                  <Link
                    href="/discover"
                    className="group inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-8 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/10 hover:border-white/20"
                  >
                    discover tokens
                  </Link>
                </div>

                {/* How it works link */}
                <div className="animate-fade-in delay-500">
                  <Link
                    href="/how-it-works"
                    className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-xs font-mono transition-colors"
                  >
                    how it works <span className="text-[10px]">→</span>
                  </Link>
                </div>
              </div>

              {/* ── RIGHT COLUMN: Glassmorphic cards ── */}
              <div className="lg:col-span-5 space-y-5 lg:mt-8">
                {/* Stats Card */}
                <div className="animate-fade-in delay-500 relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
                  <div className="absolute top-0 right-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-purple-500/5 blur-3xl pointer-events-none" />

                  <div className="relative z-10">
                    {/* Header */}
                    <div className="flex items-center gap-4 mb-7">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                        <Shield className="h-6 w-6 text-white" />
                      </div>
                      <div>
                        <div className="text-3xl font-bold tracking-tight text-white">
                          1%
                        </div>
                        <div className="text-sm text-zinc-400">
                          Total trading fee
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-3 mb-7">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Creator share</span>
                        <span className="text-white font-medium">80%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/50">
                        <div className="h-full w-[80%] rounded-full bg-gradient-to-r from-purple-400 to-white" />
                      </div>
                    </div>

                    <div className="h-px w-full bg-white/10 mb-5" />

                    {/* Mini Stats */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <StatItem value="5m" label="Fair start" />
                      <StatItem value="50+" label="Wallets" />
                      <StatItem value="2 SOL" label="Stake" />
                    </div>

                    {/* Status pills */}
                    <div className="mt-6 flex flex-wrap gap-2">
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-medium tracking-wide text-zinc-300">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </span>
                        LIVE ON DEVNET
                      </div>
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-medium tracking-wide text-zinc-300">
                        <Crown className="w-3 h-3 text-purple-400" />
                        FAIR LAUNCH
                      </div>
                    </div>
                  </div>
                </div>

                {/* Marquee Card */}
                <div className="animate-fade-in delay-600 relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 py-6 backdrop-blur-xl">
                  <h3 className="mb-5 px-6 text-sm font-medium text-zinc-400">
                    Built for the Solana ecosystem
                  </h3>

                  <div
                    className="relative flex overflow-hidden"
                    style={{
                      maskImage:
                        "linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
                      WebkitMaskImage:
                        "linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
                    }}
                  >
                    <div className="animate-marquee flex gap-12 whitespace-nowrap px-4">
                      {[...BRANDS, ...BRANDS, ...BRANDS].map((brand, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 opacity-50 transition-all hover:opacity-100 hover:scale-105 cursor-default grayscale hover:grayscale-0"
                        >
                          <brand.icon className="h-5 w-5 text-white" />
                          <span className="text-base font-bold text-white tracking-tight">
                            {brand.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="border-t border-white/10 bg-black/40 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-4 text-[8px] lg:text-[9px] font-mono text-white/40">
              <span>PROVE.PROTOCOL</span>
              <div className="hidden sm:flex gap-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-white/20"
                    style={{
                      height: `${Math.floor(4 + Math.sin(i * 1.2) * 4 + 4)}px`,
                    }}
                  />
                ))}
              </div>
              <span>SOLANA</span>
            </div>
            <div className="flex items-center gap-3 text-[8px] lg:text-[9px] font-mono text-white/40">
              <span className="hidden sm:inline">◇ BATCH.AUCTION</span>
              <div className="flex gap-1">
                <div className="w-1 h-1 bg-white/60 rounded-full animate-pulse" />
                <div
                  className="w-1 h-1 bg-white/40 rounded-full animate-pulse"
                  style={{ animationDelay: "0.2s" }}
                />
                <div
                  className="w-1 h-1 bg-white/20 rounded-full animate-pulse"
                  style={{ animationDelay: "0.4s" }}
                />
              </div>
              <span>LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
