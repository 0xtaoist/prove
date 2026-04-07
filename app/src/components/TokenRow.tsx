import Link from "next/link";

export interface TokenRowProps {
  mint: string;
  ticker: string;
  name: string;
  holderCount: number;
  volume24h: number;
  avgHoldTime: string;
  priceChange: number;
  badges: Array<"verified" | "diamond_hands" | "survivor">;
  feedScore: number;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(2);
}

const BADGE_MAP: Record<string, { label: string; color: string }> = {
  verified: { label: "verified", color: "badge-primary" },
  diamond_hands: { label: "diamond hands", color: "badge-success" },
  survivor: { label: "survivor", color: "badge-warning" },
};

export function TokenRow({
  mint,
  ticker,
  name,
  holderCount,
  volume24h,
  avgHoldTime,
  priceChange,
  badges,
  feedScore,
}: TokenRowProps) {
  const isPositive = priceChange >= 0;

  return (
    <Link
      href={`/token/${mint}`}
      className="glass-card flex flex-wrap items-center gap-4 lg:gap-6 p-4 lg:p-5 group"
    >
      {/* Identity */}
      <div className="flex flex-col min-w-[120px]">
        <span className="font-mono text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          ${ticker}
        </span>
        <span className="text-xs text-foreground-muted truncate max-w-[140px]">
          {name}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-5 flex-1">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
            holders
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {holderCount.toLocaleString()}
          </span>
        </div>

        <div className="hidden sm:flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
            24h vol
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatSol(volume24h)} SOL
          </span>
        </div>

        <div className="hidden md:flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
            avg hold
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {avgHoldTime}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
            change
          </span>
          <span
            className={`font-mono text-sm font-semibold ${
              isPositive ? "text-success" : "text-danger"
            }`}
          >
            {isPositive ? "+" : ""}
            {priceChange.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Badges + Score */}
      <div className="flex items-center gap-3">
        {badges.length > 0 && (
          <div className="hidden lg:flex items-center gap-1.5">
            {badges.map((b) => {
              const cfg = BADGE_MAP[b];
              if (!cfg) return null;
              return (
                <span key={b} className={`badge ${cfg.color}`}>
                  {cfg.label}
                </span>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 border border-primary/20">
          <span className="font-mono text-sm font-bold text-primary">
            {feedScore}
          </span>
        </div>
      </div>
    </Link>
  );
}
