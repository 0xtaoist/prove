"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useTransaction } from "./useTransaction";
import { buildSwapTx } from "../lib/transactions";

export function useSwap() {
  const { publicKey } = useWallet();
  const { sendTransaction, loading, error, signature } = useTransaction();

  /**
   * Execute a swap on the ProveAMM.
   *
   * @param poolMint    - The SPL mint address of the token being traded.
   * @param amountIn    - Amount in (SOL for buys, tokens for sells).
   * @param isBuy       - true = buy tokens with SOL, false = sell tokens for SOL.
   * @param slippageBps - Slippage tolerance in basis points (e.g. 100 = 1%).
   */
  const swap = useCallback(
    async (
      poolMint: PublicKey,
      amountIn: number,
      isBuy: boolean,
      slippageBps: number,
    ) => {
      if (!publicKey) return null;

      // Calculate minimum amount out with slippage tolerance.
      // For a real implementation this would query the pool reserves to compute
      // the expected output. For now we use the input as a rough estimate and
      // apply slippage to it.
      const slippageMultiplier = 1 - slippageBps / 10_000;
      const minAmountOut = amountIn * slippageMultiplier;

      const tx = await buildSwapTx(
        publicKey,
        poolMint,
        amountIn,
        isBuy,
        minAmountOut,
      );

      return sendTransaction(tx);
    },
    [publicKey, sendTransaction],
  );

  return { swap, loading, error, signature };
}
