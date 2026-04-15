"use client";

import { useState, useCallback, useMemo } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { PublicKey, Keypair, type Transaction } from "@solana/web3.js";

export interface UseTransactionReturn {
  sendTransaction: (tx: Transaction, extraSigners?: Keypair[]) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  signature: string | null;
  /** The active public key — from wallet-adapter or Privy */
  activeKey: PublicKey | null;
}

export function useTransaction(): UseTransactionReturn {
  const { publicKey, sendTransaction: walletSendTx } = useWallet();
  const { connection } = useConnection();
  const { authenticated, user } = usePrivy();
  const { wallets: privyWallets } = useSolanaWallets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  // Resolve the Privy wallet — try embedded wallets first, then linked accounts
  const privyWallet = useMemo(() => {
    if (!authenticated) return null;
    // useSolanaWallets returns embedded + connected wallets
    if (privyWallets?.[0]) return privyWallets[0];
    return null;
  }, [authenticated, privyWallets]);

  // Resolve address from Privy (embedded wallet or linked external wallet)
  const privyAddress = useMemo(() => {
    if (!authenticated) return null;
    // From useSolanaWallets
    if (privyWallet?.address) return privyWallet.address;
    // Fallback: scan linked accounts for a Solana wallet
    const linked = user?.linkedAccounts?.find(
      (a) => a.type === "wallet" && (a as { chainType?: string }).chainType === "solana",
    ) as { address?: string } | undefined;
    return linked?.address ?? null;
  }, [authenticated, privyWallet, user]);

  const privyKey = privyAddress ? new PublicKey(privyAddress) : null;

  // Prefer wallet-adapter (external wallets connected directly); fall back to Privy
  const activeKey = publicKey ?? privyKey;

  const sendTransaction = useCallback(
    async (tx: Transaction, extraSigners?: Keypair[]): Promise<string | null> => {
      setError(null);
      setSignature(null);

      if (!activeKey) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      try {
        tx.feePayer = activeKey;
        tx.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;

        // Sign with any extra keypairs (e.g. mint keypair) AFTER blockhash is set
        if (extraSigners?.length) {
          tx.partialSign(...extraSigners);
        }

        let sig: string;

        if (publicKey && walletSendTx) {
          // Standard wallet-adapter path (Phantom, Solflare connected directly)
          sig = await walletSendTx(tx, connection);
        } else if (privyWallet) {
          // Privy wallet path (embedded or external connected through Privy)
          sig = await privyWallet.sendTransaction(tx, connection);
        } else {
          setError("No wallet available to sign");
          setLoading(false);
          return null;
        }

        // Wait for confirmation
        const { value } = await connection.confirmTransaction(sig, "confirmed");

        if (value.err) {
          setError(`Transaction failed: ${JSON.stringify(value.err)}`);
          setLoading(false);
          return null;
        }

        setSignature(sig);
        setLoading(false);
        return sig;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Transaction failed";

        if (
          message.includes("User rejected") ||
          message.includes("user rejected")
        ) {
          setError("Transaction cancelled by user");
        } else {
          setError(message);
        }

        setLoading(false);
        return null;
      }
    },
    [activeKey, publicKey, connection, walletSendTx, privyWallet],
  );

  return { sendTransaction, loading, error, signature, activeKey };
}
