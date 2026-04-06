"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useSwap } from "../../../hooks/useSwap";
import styles from "./TradeWidget.module.css";

const SLIPPAGE_OPTIONS = [0.5, 1, 2] as const;

interface TradeWidgetProps {
  ticker: string;
  mint: string;
  currentPrice: number; // lamports per token
}

export function TradeWidget({ ticker, mint, currentPrice }: TradeWidgetProps) {
  const { connected } = useWallet();
  const { swap, loading: swapLoading, error: swapError, signature: swapSig } = useSwap();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(1);

  const rawAmount = parseFloat(amount) || 0;
  const priceInSol = currentPrice / 1e9;

  const estimatedTokens =
    side === "buy" && priceInSol > 0 ? (rawAmount * 0.99) / priceInSol : 0;

  const estimatedSol =
    side === "sell" ? rawAmount * priceInSol * 0.99 : 0;

  const fee = rawAmount * 0.01;
  const creatorFee = rawAmount * 0.008;
  const protocolFee = rawAmount * 0.002;

  return (
    <div className={styles.widget}>
      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${side === "buy" ? styles.tabActiveBuy : ""}`}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          className={`${styles.tab} ${side === "sell" ? styles.tabActiveSell : ""}`}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>

      {/* Amount input */}
      <div className={styles.inputGroup}>
        <span className={styles.inputLabel}>
          {side === "buy" ? "Amount (SOL)" : `Amount (${ticker})`}
        </span>
        <input
          className={styles.inputField}
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      {/* Estimated output */}
      {rawAmount > 0 && (
        <div className={styles.estimate}>
          {side === "buy"
            ? `Est. output: ${estimatedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ticker}`
            : `Est. output: ${estimatedSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`}
        </div>
      )}

      {/* Slippage selector */}
      <div className={styles.slippageRow}>
        <span className={styles.slippageLabel}>Slippage</span>
        <div className={styles.slippageGroup}>
          {SLIPPAGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              className={`${styles.slippageBtn} ${slippage === opt ? styles.slippageBtnActive : ""}`}
              onClick={() => setSlippage(opt)}
            >
              {opt}%
            </button>
          ))}
        </div>
      </div>

      {/* Fee breakdown */}
      <div className={styles.feeBreakdown}>
        1% fee: 0.8% to creator, 0.2% protocol
        {rawAmount > 0 && (
          <>
            <br />
            Fee: {fee.toFixed(4)} SOL (creator: {creatorFee.toFixed(4)}, protocol:{" "}
            {protocolFee.toFixed(4)})
          </>
        )}
      </div>

      {/* Action */}
      {swapError && (
        <div style={{ color: "#f44336", fontSize: 13, marginBottom: 8 }}>
          {swapError}
        </div>
      )}
      {swapSig && (
        <div style={{ color: "#4caf50", fontSize: 13, marginBottom: 8 }}>
          Swap confirmed: {swapSig.slice(0, 16)}...
        </div>
      )}

      {connected ? (
        <button
          className={`${styles.actionBtn} ${side === "buy" ? styles.actionBtnBuy : styles.actionBtnSell}`}
          disabled={rawAmount <= 0 || swapLoading}
          onClick={async () => {
            const poolMint = new PublicKey(mint);
            const slippageBps = slippage * 100; // e.g. 1% -> 100 bps
            await swap(poolMint, rawAmount, side === "buy", slippageBps);
          }}
        >
          {swapLoading
            ? "Sending..."
            : `${side === "buy" ? "Buy" : "Sell"} ${ticker}`}
        </button>
      ) : (
        <div className={styles.walletMessage}>
          Connect wallet to trade
          <div style={{ marginTop: 8 }}>
            <WalletMultiButton
              style={{ borderRadius: 0, width: "100%", justifyContent: "center" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
