"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const network =
    (process.env.NEXT_PUBLIC_SOLANA_NETWORK as string) === "mainnet-beta"
      ? WalletAdapterNetwork.Mainnet
      : WalletAdapterNetwork.Devnet;

  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.mainnet-beta.solana.com";

  const solanaConnectors = useMemo(() => toSolanaWalletConnectors(), []);

  // Phantom registers as a Standard Wallet automatically — no adapter needed.
  // Privy's toSolanaWalletConnectors() handles wallet injection.
  const wallets = useMemo(() => [], []);

  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Privy is the primary login surface. If PRIVY_APP_ID is not configured we
  // fall back to wallet-adapter only (dev mode), but production must set it.
  if (!privyAppId) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[providers] NEXT_PUBLIC_PRIVY_APP_ID is not set; Privy login disabled.",
      );
    }
    return (
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    );
  }

  // Privy must wrap the wallet adapter so its embedded/external wallets
  // register as wallet-adapter wallets. The solanaConnectors bridge injects
  // Privy wallets into useWallet() so `connected` and `publicKey` work
  // automatically after Privy login.
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email", "wallet", "google", "twitter"],
        appearance: {
          theme: "dark",
          accentColor: "#22d3ee",
          walletChainType: "solana-only",
        },
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </PrivyProvider>
  );
}
