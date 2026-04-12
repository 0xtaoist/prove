"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useMemo } from "react";

/**
 * Unified view of the signed-in user. Returns the Solana address Privy has
 * linked for the user (whether via embedded wallet, email → embedded wallet,
 * or external wallet like Phantom connected through Privy).
 *
 * This is the single source of truth the UI should use for "who is logged in".
 * On-chain signing still flows through `useWallet` from wallet-adapter, which
 * Privy registers its wallets against.
 */
export function usePrivyWallet() {
  const { ready, authenticated, login, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();

  const address = useMemo(() => {
    if (!authenticated) return null;
    // Prefer the most recently linked Solana wallet from Privy.
    const w = wallets?.[0];
    if (w?.address) return w.address;
    // Fall back to the linkedAccounts scan.
    const linked = user?.linkedAccounts?.find(
      (a) => a.type === "wallet" && (a as { chainType?: string }).chainType === "solana",
    ) as { address?: string } | undefined;
    return linked?.address ?? null;
  }, [authenticated, wallets, user]);

  return {
    ready,
    authenticated,
    address,
    login,
    logout,
    privyUserId: user?.id ?? null,
    getAccessToken,
  };
}
