const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Format lamports to SOL with 2-4 decimal places.
 * Accepts bigint or string (for deserialized JSON).
 */
export function formatSol(lamports: bigint | string): string {
  const val = typeof lamports === "string" ? BigInt(lamports) : lamports;
  const negative = val < 0n;
  const abs = negative ? -val : val;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = abs % LAMPORTS_PER_SOL;

  // Convert fractional part to a decimal string with 9 digits
  const fracStr = frac.toString().padStart(9, "0");

  // Use 4 decimals for small values, 2 for large
  const decimals = whole < 10n ? 4 : 2;
  const trimmed = fracStr.slice(0, decimals);

  return `${negative ? "-" : ""}${whole}.${trimmed}`;
}

/**
 * Format a number with compact notation (1.2K, 3.4M, etc.).
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString("en-US");
}

/**
 * Format a duration in seconds to a human-readable string.
 * "2h 15m", "3d 12h", "45s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0s";

  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format a unix timestamp (ms) to a relative "time ago" string.
 * "5m ago", "2h ago", "3d ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Shorten a Solana address: "Abc1...xyz9"
 */
export function shortenAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
