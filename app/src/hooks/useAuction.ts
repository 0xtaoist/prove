"use client";

import { useCallback } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useTransaction } from "./useTransaction";
import {
  buildCreateAuctionTx,
  buildCommitSolTx,
  buildClaimTokensTx,
  buildRefundTx,
} from "../lib/transactions";

export function useAuction() {
  const { activeKey: publicKey, sendTransaction, loading, error, signature } = useTransaction();

  const createAuction = useCallback(
    async (
      ticker: string,
      totalSupply: number,
      tokenName?: string,
      metadataUri?: string,
      mintKeypair?: Keypair,
    ) => {
      if (!publicKey) return null;

      const mint = mintKeypair ?? Keypair.generate();

      const tx = await buildCreateAuctionTx(
        publicKey,
        ticker,
        totalSupply,
        mint.publicKey,
        tokenName,
        metadataUri,
      );

      return sendTransaction(tx, [mint]);
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
