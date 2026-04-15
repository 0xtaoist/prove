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
  const { publicKey, signTransaction, sendTransaction: walletSendTx } = useWallet();
  const { connection } = useConnection();
  const { authenticated, user } = usePrivy();
  const { wallets: privyWallets } = useSolanaWallets();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const privyWallet = useMemo(() => {
    if (!authenticated) return null;
    if (privyWallets?.[0]) return privyWallets[0];
    return null;
  }, [authenticated, privyWallets]);

  const privyAddress = useMemo(() => {
    if (!authenticated) return null;
    if (privyWallet?.address) return privyWallet.address;
    const linked = user?.linkedAccounts?.find(
      (a) => a.type === "wallet" && (a as { chainType?: string }).chainType === "solana",
    ) as { address?: string } | undefined;
    return linked?.address ?? null;
  }, [authenticated, privyWallet, user]);

  const privyKey = privyAddress ? new PublicKey(privyAddress) : null;
  const activeKey = publicKey ?? privyKey;

  const sendTx = useCallback(
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

        // Sign with extra keypairs first (e.g. mint keypair)
        if (extraSigners?.length) {
          tx.partialSign(...extraSigners);
        }

        let sig: string;

        if (publicKey && signTransaction) {
          const signed = await signTransaction(tx);
          const raw = signed.serialize();
          sig = await connection.sendRawTransaction(raw, { skipPreflight: true });
        } else if (privyWallet) {
          const signed = await privyWallet.signTransaction(tx);
          const raw = signed.serialize();
          sig = await connection.sendRawTransaction(raw, { skipPreflight: true });
        } else {
          setError("No wallet available to sign");
          setLoading(false);
          return null;
        }

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
    [activeKey, publicKey, connection, signTransaction, walletSendTx, privyWallet],
  );

  return { sendTransaction: sendTx, loading, error, signature, activeKey };
}
