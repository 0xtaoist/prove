"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useTransaction } from "./useTransaction";
import {
  buildCreateAuctionTx,
  buildCommitSolTx,
  buildClaimTokensTx,
  buildRefundTx,
} from "../lib/transactions";

export function useAuction() {
  const { publicKey } = useWallet();
  const { sendTransaction, loading, error, signature } = useTransaction();

  const createAuction = useCallback(
    async (ticker: string, totalSupply: number) => {
      if (!publicKey) return null;

      // Generate a new mint keypair for the auction token.
      // In production the mint may be created by the program or passed in;
      // for now we generate one client-side so the PDA derivation works.
      const mint = Keypair.generate();

      const tx = await buildCreateAuctionTx(
        publicKey,
        ticker,
        totalSupply,
        mint.publicKey,
      );

      // The mint keypair needs to sign the transaction as well
      tx.partialSign(mint);

      return sendTransaction(tx);
    },
    [publicKey, sendTransaction],
  );

  const commitSol = useCallback(
    async (auctionMint: PublicKey, amount: number) => {
      if (!publicKey) return null;
      const tx = await buildCommitSolTx(publicKey, auctionMint, amount);
      return sendTransaction(tx);
    },
    [publicKey, sendTransaction],
  );

  const claimTokens = useCallback(
    async (auctionMint: PublicKey) => {
      if (!publicKey) return null;
      const tx = await buildClaimTokensTx(publicKey, auctionMint);
      return sendTransaction(tx);
    },
    [publicKey, sendTransaction],
  );

  const refund = useCallback(
    async (auctionMint: PublicKey) => {
      if (!publicKey) return null;
      const tx = await buildRefundTx(publicKey, auctionMint);
      return sendTransaction(tx);
    },
    [publicKey, sendTransaction],
  );

  return {
    createAuction,
    commitSol,
    claimTokens,
    refund,
    loading,
    error,
    signature,
  };
}
