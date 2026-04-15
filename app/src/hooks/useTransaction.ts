"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { usePrivy } from "@privy-io/react-auth";
import { PublicKey, type Transaction } from "@solana/web3.js";

export interface UseTransactionReturn {
  sendTransaction: (tx: Transaction) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  signature: string | null;
  /** The active public key — from wallet-adapter or Privy */
  activeKey: PublicKey | null;
}

export function useTransaction(): UseTransactionReturn {
  const { publicKey, sendTransaction: walletSendTx } = useWallet();
  const { connection } = useConnection();
  const { authenticated } = usePrivy();
  const { wallets: privyWallets } = useSolanaWallets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  // Prefer wallet-adapter key; fall back to Privy embedded wallet
  const privyWallet = authenticated ? privyWallets?.[0] : null;
  const privyKey = privyWallet?.address
    ? new PublicKey(privyWallet.address)
    : null;
  const activeKey = publicKey ?? privyKey;

  const sendTransaction = useCallback(
    async (tx: Transaction): Promise<string | null> => {
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

        let sig: string;

        if (publicKey && walletSendTx) {
          // Standard wallet-adapter path (Phantom, Solflare, etc.)
          sig = await walletSendTx(tx, connection);
        } else if (privyWallet) {
          // Privy embedded wallet path
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
