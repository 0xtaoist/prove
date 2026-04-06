import Link from "next/link";

export interface TokenCardProps {
  mint: string;
  ticker: string;
  name: string;
  holderCount: number;
  volume24h: number;
  avgHoldTime: string;
  priceChangePct: number;
  badges: Array<"verified" | "diamond_hands" | "survivor">;
  feedScore: number;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(2);
}

const BADGE_CONFIG: Record<string, { label: string; color: string }> = {
  verified: { label: "Verified", color: "badge-primary" },
  diamond_hands: { label: "Diamond Hands", color: "badge-success" },
  survivor: { label: "Survivor", color: "badge-warning" },
};

export function TokenCard({
  mint,
  ticker,
  name,
  holderCount,
  volume24h,
  avgHoldTime,
  priceChangePct,
  badges,
  feedScore,
}: TokenCardProps) {
  const isPositive = priceChangePct >= 0;

  return (
    <Link href={`/token/${mint}`} className="glass-card p-5 group block">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm font-bold text-foreground group-hover:text-primary transition-colors">
          ${ticker}
        </span>
        <span
          className={`font-mono text-sm font-bold ${
            isPositive ? "text-success" : "text-danger"
          }`}
        >
          {isPositive ? "+" : ""}
          {priceChangePct.toFixed(1)}%
        </span>
      </div>

      <p className="text-sm text-foreground-muted mb-4 truncate">{name}</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-0.5">
            Holders
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {holderCount.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-0.5">
            24h Vol
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatSol(volume24h)}
          </span>
        </div>
        <div>
          <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-0.5">
            Avg Hold
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {avgHoldTime}
          </span>
        </div>
      </div>

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {badges.map((b) => {
            const cfg = BADGE_CONFIG[b];
            if (!cfg) return null;
            return (
              <span key={b} className={`badge ${cfg.color}`}>
                {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border/50">
        <span className="text-[10px] uppercase tracking-wider text-foreground-muted font-mono">
          Feed Score
        </span>
        <span className="font-mono text-sm font-bold text-primary">
          {feedScore}
        </span>
      </div>
    </Link>
  );
}
