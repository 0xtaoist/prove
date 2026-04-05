"use client";

import { useState, useEffect, useCallback, type FormEvent, type ChangeEvent } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import styles from "./page.module.css";

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
    if (!form.name.trim()) {
      errs.name = "Token name is required";
    }
    if (!form.description.trim()) {
      errs.description = "Description is required";
    }
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
    // Clear field error on change
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
    <div className={styles.page}>
      <h1 className={styles.title}>Launch a Token</h1>
      <p className={styles.subtitle}>
        Create a fair-launch token with a batch auction. Stake 2 SOL to begin.
      </p>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {/* Ticker */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="ticker">
            Ticker
          </label>
          <input
            id="ticker"
            name="ticker"
            className={styles.inputMono}
            placeholder="e.g. PROVE"
            value={form.ticker}
            onChange={handleChange}
            maxLength={10}
            autoComplete="off"
          />
          {errors.ticker && <span className={styles.error}>{errors.ticker}</span>}
        </div>

        {/* Name */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="name">
            Token Name
          </label>
          <input
            id="name"
            name="name"
            className={styles.input}
            placeholder="e.g. Prove Protocol"
            value={form.name}
            onChange={handleChange}
          />
          {errors.name && <span className={styles.error}>{errors.name}</span>}
        </div>

        {/* Description */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            className={styles.textarea}
            placeholder="What is this token about?"
            value={form.description}
            onChange={handleChange}
            rows={4}
          />
          {errors.description && (
            <span className={styles.error}>{errors.description}</span>
          )}
        </div>

        {/* Total Supply */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="totalSupply">
            Total Supply
          </label>
          <input
            id="totalSupply"
            name="totalSupply"
            className={styles.inputMono}
            placeholder="e.g. 1000000000"
            type="number"
            min="1"
            step="1"
            value={form.totalSupply}
            onChange={handleChange}
          />
          {errors.totalSupply && (
            <span className={styles.error}>{errors.totalSupply}</span>
          )}
        </div>

        {/* Image */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Token Image</label>
          <input
            type="file"
            accept="image/*"
            className={styles.fileInput}
            onChange={handleFile}
          />
        </div>

        {/* Fee Breakdown */}
        <div className={styles.feeBox}>
          <div className={styles.feeTitle}>Fee Breakdown</div>
          <div className={styles.feeRow}>
            <span className={styles.feeLabel}>Creator Stake</span>
            <span className={styles.feeValue}>2.00 SOL</span>
          </div>
          <p className={styles.feeNote}>
            Refundable if the token reaches 100 unique holders within 72 hours
            of the auction completing.
          </p>
        </div>

        {/* Wallet Info */}
        {connected && publicKey && (
          <div className={styles.walletInfo}>
            <div>
              <div className={styles.walletLabel}>Connected Wallet</div>
              <div className={styles.walletAddress}>
                {truncateAddress(publicKey.toBase58())}
              </div>
            </div>
            <div className={styles.walletBalance}>
              {balance !== null ? `${balance.toFixed(4)} SOL` : "..."}
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={!connected}
        >
          {connected ? `Launch \u2014 Pay ${STAKE_AMOUNT} SOL Stake` : "Connect Wallet to Launch"}
        </button>
      </form>

      {/* Confirmation Modal */}
      {showModal && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowModal(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Confirm Launch</h2>
            <div className={styles.modalRow}>
              <span className={styles.modalLabel}>Ticker</span>
              <span className={styles.modalValue}>${form.ticker}</span>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalLabel}>Name</span>
              <span className={styles.modalValue}>{form.name}</span>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalLabel}>Supply</span>
              <span className={styles.modalValue}>
                {Number(form.totalSupply).toLocaleString()}
              </span>
            </div>
            <div className={styles.modalRow}>
              <span className={styles.modalLabel}>Stake</span>
              <span className={styles.modalValue}>{STAKE_AMOUNT} SOL</span>
            </div>
            {form.image && (
              <div className={styles.modalRow}>
                <span className={styles.modalLabel}>Image</span>
                <span className={styles.modalValue}>{form.image.name}</span>
              </div>
            )}
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancel}
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                className={styles.modalConfirm}
                onClick={() => {
                  // TODO: call BatchAuction.create_auction
                  setShowModal(false);
                  alert(
                    `Would create auction for $${form.ticker} with supply ${form.totalSupply}`,
                  );
                }}
              >
                Confirm Launch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
