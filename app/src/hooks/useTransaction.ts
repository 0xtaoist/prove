"use client";

import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";

export interface UseTransactionReturn {
  sendTransaction: (tx: Transaction) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  signature: string | null;
}

export function useTransaction(): UseTransactionReturn {
  const { publicKey, sendTransaction: walletSendTx } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const sendTransaction = useCallback(
    async (tx: Transaction): Promise<string | null> => {
      setError(null);
      setSignature(null);

      if (!publicKey) {
        setError("Wallet not connected");
        return null;
      }

      setLoading(true);
      try {
        tx.feePayer = publicKey;
        tx.recentBlockhash = (
          await connection.getLatestBlockhash()
        ).blockhash;

        const sig = await walletSendTx(tx, connection);

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

        // Detect user rejection
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
    [publicKey, connection, walletSendTx],
  );

  return { sendTransaction, loading, error, signature };
}
