/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@prove/common"],
  env: {
    NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK || "mainnet-beta",
    NEXT_PUBLIC_INDEXER_URL: process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:4000",
    NEXT_PUBLIC_BATCH_AUCTION_PROGRAM_ID: process.env.NEXT_PUBLIC_BATCH_AUCTION_PROGRAM_ID || "D92hy2gaPK8uzTvfncRBsu2RXHZP7ZEsjRbynvc2tBdD",
    NEXT_PUBLIC_STAKE_MANAGER_PROGRAM_ID: process.env.NEXT_PUBLIC_STAKE_MANAGER_PROGRAM_ID || "3MWbnFSuwGpxRgGaYgtRRABmC8HDjdmZctjf5JZm5faE",
    NEXT_PUBLIC_FEE_ROUTER_PROGRAM_ID: process.env.NEXT_PUBLIC_FEE_ROUTER_PROGRAM_ID || "6RMoCadvfUsKCYMsTNUKv9vXk6MfrVHRkB7iZ6Kd6gck",
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "",
  },
};

module.exports = nextConfig;
