import { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileClient } from "./ProfileClient";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function shortenAddress(addr: string): string {
  if (addr.length <= 8) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function getProfileData(wallet: string) {
  return {
    wallet,
    proveScore: 67,
    breakdown: {
      totalHoldTime: "42.3d",
      auctionsParticipated: 8,
      questContributions: 14,
      earlyDumpRatio: 0.12,
    },
    lastActive: "2026-04-03",
    scoreDecay: "0.5/day (inactive >7d)",
    holdings: [
      { mint: "abc123", ticker: "$PROVE", balance: 12_500, pnl: 2_400_000_000, holdDuration: "12.3d" },
      { mint: "def456", ticker: "$ALPHA", balance: 8_200, pnl: -800_000_000, holdDuration: "5.1d" },
      { mint: "ghi789", ticker: "$BETA", balance: 45_000, pnl: 600_000_000, holdDuration: "2.8d" },
    ],
    auctions: [
      { id: "a1", token: "$PROVE", mint: "abc123", outcome: "succeeded" as const, tokensClaimed: 5_000, solCommitted: 2_500_000_000, date: "2026-03-20" },
      { id: "a2", token: "$GAMMA", mint: "jkl012", outcome: "failed" as const, tokensClaimed: 0, solCommitted: 1_000_000_000, date: "2026-03-15" },
      { id: "a3", token: "$ALPHA", mint: "def456", outcome: "succeeded" as const, tokensClaimed: 8_200, solCommitted: 3_200_000_000, date: "2026-03-10" },
    ],
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>;
}): Promise<Metadata> {
  const { wallet } = await params;
  if (!BASE58_RE.test(wallet)) return { title: "Not Found \u2014 PROVE" };
  return { title: `Profile ${shortenAddress(wallet)} \u2014 PROVE` };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;
  if (!BASE58_RE.test(wallet)) notFound();
  const data = getProfileData(wallet);
  return <ProfileClient data={data} />;
}
