"use client";

export function useSwap() {
  const openSwap = (mint: string, isBuy: boolean) => {
    // Open Jupiter aggregator with the token pre-selected
    const base = isBuy ? "So11111111111111111111111111111111111111112" : mint;
    const quote = isBuy ? mint : "So11111111111111111111111111111111111111112";
    window.open(`https://jup.ag/swap/${base}-${quote}`, "_blank");
  };
  return { openSwap };
}
