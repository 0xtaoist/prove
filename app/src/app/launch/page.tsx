"use client";

import { useState, useCallback, type FormEvent, type ChangeEvent } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuction } from "../../hooks/useAuction";

interface FormData {
  ticker: string;
  name: string;
  description: string;
  totalSupply: string;
  image: File | null;
}

interface FormErrors {
  ticker?: string;
  name?: string;
  description?: string;
  totalSupply?: string;
}

const TICKER_RE = /^[A-Z0-9]{1,10}$/;
const STAKE_AMOUNT = 2;

export default function LaunchPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const { createAuction, loading: auctionLoading, error: auctionError, signature: auctionSig } = useAuction();
  const [balance, setBalance] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>({
    ticker: "",
    name: "",
    description: "",
    totalSupply: "",
    image: null,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    connection.getBalance(publicKey).then((bal) => {
      if (!cancelled) setBalance(bal / 1e9);
    });
    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  const validate = useCallback((): FormErrors => {
    const errs: FormErrors = {};
    if (!form.ticker) {
      errs.ticker = "Ticker is required";
    } else if (!TICKER_RE.test(form.ticker)) {
      errs.ticker = "Ticker must be 1-10 characters, A-Z and 0-9 only";
    }
    if (!form.name.trim()) errs.name = "Token name is required";
    if (!form.description.trim()) errs.description = "Description is required";
    const supply = Number(form.totalSupply);
    if (!form.totalSupply || isNaN(supply) || supply <= 0) {
      errs.totalSupply = "Enter a valid positive number";
    } else if (!Number.isInteger(supply)) {
      errs.totalSupply = "Supply must be a whole number";
    }
    return errs;
  }, [form]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setShowModal(true);
  };

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name: field, value } = e.target;
    if (field === "ticker") {
      setForm((prev) => ({ ...prev, ticker: value.toUpperCase().slice(0, 10) }));
    } else {
      setForm((prev) => ({ ...prev, [field]: value }));
    }
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, image: e.target.files?.[0] ?? null }));
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Launch a Token
        </h1>
        <p className="text-foreground-muted mb-10">
          Create a fair-launch token with a batch auction. Stake 2 SOL to begin.
        </p>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="space-y-6"
        onSubmit={handleSubmit}
        noValidate
      >
        {/* Ticker */}
        <div>
          <label htmlFor="ticker" className="block text-sm font-medium text-foreground mb-2">
            Ticker
          </label>
          <input
            id="ticker"
            name="ticker"
            className="input font-mono"
            placeholder="e.g. PROVE"
            value={form.ticker}
            onChange={handleChange}
            maxLength={10}
            autoComplete="off"
          />
          {errors.ticker && (
            <p className="text-xs text-danger mt-1.5">{errors.ticker}</p>
          )}
        </div>

        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
            Token Name
          </label>
          <input
            id="name"
            name="name"
            className="input"
            placeholder="e.g. Prove Protocol"
            value={form.name}
            onChange={handleChange}
          />
          {errors.name && (
            <p className="text-xs text-danger mt-1.5">{errors.name}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-foreground mb-2">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            className="input min-h-[100px] resize-y"
            placeholder="What is this token about?"
            value={form.description}
            onChange={handleChange}
            rows={4}
          />
          {errors.description && (
            <p className="text-xs text-danger mt-1.5">{errors.description}</p>
          )}
        </div>

        {/* Total Supply */}
        <div>
          <label htmlFor="totalSupply" className="block text-sm font-medium text-foreground mb-2">
            Total Supply
          </label>
          <input
            id="totalSupply"
            name="totalSupply"
            className="input font-mono"
            placeholder="e.g. 1000000000"
            type="number"
            min="1"
            step="1"
            value={form.totalSupply}
            onChange={handleChange}
          />
          {errors.totalSupply && (
            <p className="text-xs text-danger mt-1.5">{errors.totalSupply}</p>
          )}
        </div>

        {/* Image */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Token Image
          </label>
          <div className="glass-card p-4">
            <input
              type="file"
              accept="image/*"
              className="text-sm text-foreground-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:cursor-pointer file:transition-colors"
              onChange={handleFile}
            />
          </div>
        </div>

        {/* Fee Breakdown */}
        <div className="glass-card p-5 bg-gradient-to-br from-primary/5 to-transparent">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Fee Breakdown
          </h3>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-foreground-muted">Creator Stake</span>
            <span className="font-mono text-sm font-semibold text-foreground">
              2.00 SOL
            </span>
          </div>
          <p className="text-xs text-foreground-muted/70 leading-relaxed">
            Refundable if the token reaches 100 unique holders within 72 hours
            of the auction completing.
          </p>
        </div>

        {/* Wallet Info */}
        <AnimatePresence>
          {connected && publicKey && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="glass-card p-5 flex items-center justify-between"
            >
              <div>
                <span className="block text-[10px] uppercase tracking-wider text-foreground-muted font-mono mb-1">
                  Connected Wallet
                </span>
                <span className="font-mono text-sm text-foreground">
                  {truncateAddress(publicKey.toBase58())}
                </span>
              </div>
              <span className="font-mono text-sm font-semibold text-foreground">
                {balance !== null ? `${balance.toFixed(4)} SOL` : "..."}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit */}
        <button
          type="submit"
          className="btn-primary w-full py-4 text-base"
          disabled={!connected || auctionLoading}
        >
          {auctionLoading
            ? "Sending Transaction..."
            : connected
              ? `Launch \u2014 Pay ${STAKE_AMOUNT} SOL Stake`
              : "Connect Wallet to Launch"}
        </button>

        {auctionError && (
          <p className="text-xs text-danger mt-2">{auctionError}</p>
        )}
        {auctionSig && (
          <p className="text-xs text-success mt-2 font-mono">
            Success! Tx: {auctionSig.slice(0, 16)}...
          </p>
        )}
      </motion.form>

      {/* ── Confirmation Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="glass-card p-6 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-foreground mb-5">
                Confirm Launch
              </h2>

              <div className="space-y-3 mb-6">
                {[
                  { label: "Ticker", value: `$${form.ticker}` },
                  { label: "Name", value: form.name },
                  {
                    label: "Supply",
                    value: Number(form.totalSupply).toLocaleString(),
                  },
                  { label: "Stake", value: `${STAKE_AMOUNT} SOL` },
                  ...(form.image
                    ? [{ label: "Image", value: form.image.name }]
                    : []),
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                  >
                    <span className="text-sm text-foreground-muted">
                      {row.label}
                    </span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  className="btn-outline flex-1"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary flex-1"
                  disabled={auctionLoading}
                  onClick={async () => {
                    const sig = await createAuction(
                      form.ticker,
                      Number(form.totalSupply),
                    );
                    setShowModal(false);
                    if (sig) {
                      alert(`Auction created! Signature: ${sig}`);
                    }
                  }}
                >
                  {auctionLoading ? "Sending..." : "Confirm Launch"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
