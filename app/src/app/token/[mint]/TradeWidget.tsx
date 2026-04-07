"use client";

import { useState } from "react";
import { useSwap } from "../../../hooks/useSwap";
import styles from "./TradeWidget.module.css";

interface TradeWidgetProps {
  ticker: string;
  mint: string;
  currentPrice: number;
}

export function TradeWidget({ ticker, mint, currentPrice }: TradeWidgetProps) {
  const { openSwap } = useSwap();
  const [side, setSide] = useState<"buy" | "sell">("buy");

  const priceInSol = currentPrice / 1e9;

  return (
    <div className={styles.widget}>
      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${side === "buy" ? styles.tabBuyActive : ""}`}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          className={`${styles.tab} ${side === "sell" ? styles.tabSellActive : ""}`}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>

      {/* Price display */}
      <div className={styles.inputGroup}>
        <span className={styles.inputLabel}>Current Price</span>
        <div style={{ padding: "8px 0", fontSize: 16 }}>
          {priceInSol.toFixed(9)} SOL per {ticker}
        </div>
      </div>

      {/* Fee info */}
      <div className={styles.feeBreakdown}>
        1% swap fee on all trades — 0.8% to creator, 0.2% to protocol
      </div>

      {/* Action */}
      <button
        className={`${styles.actionBtn} ${side === "buy" ? styles.actionBtnBuy : styles.actionBtnSell}`}
        onClick={() => openSwap(mint, side === "buy")}
      >
        {side === "buy" ? "Buy" : "Sell"} {ticker} on Jupiter
      </button>
    </div>
  );
}
