import Link from "next/link";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton,
    ),
  { ssr: false },
);

export function Nav() {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        maxWidth: 1200,
        margin: "0 auto",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--accent-primary)",
            letterSpacing: "0.05em",
          }}
        >
          PROVE
        </Link>
        <Link
          href="/launch"
          style={{ fontSize: 14, color: "var(--text-secondary)" }}
        >
          Launch
        </Link>
      </div>
      <WalletMultiButton />
    </nav>
  );
}
