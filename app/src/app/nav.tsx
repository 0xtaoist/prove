"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton,
    ),
  { ssr: false },
);

const navLinks = [
  { href: "/discover", label: "discover" },
  { href: "/launch", label: "launch" },
  { href: "/creators", label: "creators" },
];

export function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav
      style={{
        height: 64,
        borderBottom: "1px solid var(--border)",
        background: "var(--background)",
        position: "relative",
      }}
    >
      <div
        style={{
          maxWidth: 1152,
          margin: "0 auto",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderLeft: "1px solid var(--border)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* Left: Logo */}
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--primary)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          PROVE
        </Link>

        {/* Center: Nav links (desktop) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
          }}
          className="nav-links-desktop"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                fontSize: 14,
                padding: "8px 16px",
                color: isActive(link.href)
                  ? "var(--primary)"
                  : "var(--muted-foreground)",
                background: isActive(link.href)
                  ? "rgba(124, 58, 237, 0.1)"
                  : "transparent",
                textDecoration: "none",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive(link.href)) {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(124, 58, 237, 0.08)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive(link.href)) {
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
                }
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right: Wallet + hamburger */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="wallet-desktop">
            <WalletMultiButton />
          </div>

          {/* Hamburger (mobile) */}
          <button
            className="hamburger-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
            style={{
              display: "none",
              flexDirection: "column",
              justifyContent: "center",
              gap: 4,
              width: 32,
              height: 32,
              padding: 4,
              cursor: "pointer",
              background: "none",
              border: "none",
            }}
          >
            <span
              style={{
                display: "block",
                width: "100%",
                height: 2,
                background: "var(--foreground)",
                transition: "transform 0.2s ease",
                transform: menuOpen ? "rotate(45deg) translate(4px, 4px)" : "none",
              }}
            />
            <span
              style={{
                display: "block",
                width: "100%",
                height: 2,
                background: "var(--foreground)",
                opacity: menuOpen ? 0 : 1,
                transition: "opacity 0.2s ease",
              }}
            />
            <span
              style={{
                display: "block",
                width: "100%",
                height: 2,
                background: "var(--foreground)",
                transition: "transform 0.2s ease",
                transform: menuOpen ? "rotate(-45deg) translate(4px, -4px)" : "none",
              }}
            />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          className="mobile-menu"
          style={{
            position: "absolute",
            top: 64,
            left: 0,
            right: 0,
            background: "var(--background)",
            borderBottom: "1px solid var(--border)",
            zIndex: 50,
            display: "none",
            flexDirection: "column",
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              style={{
                fontSize: 14,
                padding: "12px 16px",
                color: isActive(link.href)
                  ? "var(--primary)"
                  : "var(--muted-foreground)",
                background: isActive(link.href)
                  ? "rgba(124, 58, 237, 0.1)"
                  : "transparent",
                borderBottom: "1px solid var(--border)",
                textDecoration: "none",
              }}
            >
              {link.label}
            </Link>
          ))}
          <div style={{ padding: 16 }}>
            <WalletMultiButton />
          </div>
        </div>
      )}

      {/* Responsive styles */}
      <style>{`
        .nav-links-desktop { display: flex !important; }
        .wallet-desktop { display: block !important; }
        .hamburger-btn { display: none !important; }
        .mobile-menu { display: none !important; }

        @media (max-width: 768px) {
          .nav-links-desktop { display: none !important; }
          .wallet-desktop { display: none !important; }
          .hamburger-btn { display: flex !important; }
          .mobile-menu { display: flex !important; }
        }
      `}</style>
    </nav>
  );
}
