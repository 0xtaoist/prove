import { prisma } from "./db";

/**
 * Canonical, hard-coded platform invariants. These MUST match what is
 * enforced on-chain by the fee-router program and what is pinned by the
 * CHECK constraint on the ProtocolConfig row in the database.
 *
 * If any of these three layers ever disagree, fee distribution is broken
 * and this service will refuse to start.
 *
 * NOTE: The DB column is named "creatorBps" / "protocolBps" for historical
 * reasons, but the actual values represent whole-number percentages (80/20),
 * NOT basis points (8000/2000). splitFee() divides by 100 accordingly.
 */
export const REQUIRED_CREATOR_PCT = 80;
export const REQUIRED_PROTOCOL_PCT = 20;
const PLACEHOLDER_VAULT = "REPLACE_ME_PROTOCOL_VAULT";

export interface ProtocolConfigSnapshot {
  creatorBps: number;
  protocolBps: number;
  protocolVaultAddress: string;
}

/**
 * Verify (and seed if missing) the ProtocolConfig singleton row.
 *
 * - Seeds the row if it's missing, using PROTOCOL_VAULT_ADDRESS from env.
 * - Fails loudly if the split isn't 80/20.
 * - Fails loudly if the vault address is still the placeholder.
 *
 * Call this at boot before starting the fee collector.
 */
export async function assertProtocolConfig(): Promise<ProtocolConfigSnapshot> {
  const envVault = process.env.PROTOCOL_VAULT_ADDRESS;

  let cfg = await prisma.protocolConfig.findUnique({ where: { id: 1 } });

  if (!cfg) {
    if (!envVault) {
      throw new Error(
        "ProtocolConfig row is missing and PROTOCOL_VAULT_ADDRESS env var is not set. " +
          "Set PROTOCOL_VAULT_ADDRESS to the protocol treasury address and restart.",
      );
    }
    cfg = await prisma.protocolConfig.create({
      data: {
        id: 1,
        creatorBps: REQUIRED_CREATOR_PCT,
        protocolBps: REQUIRED_PROTOCOL_PCT,
        protocolVaultAddress: envVault,
      },
    });
    console.log(
      `[protocol-config] Seeded ProtocolConfig with vault ${envVault}`,
    );
  }

  if (cfg.creatorBps !== REQUIRED_CREATOR_PCT) {
    throw new Error(
      `ProtocolConfig.creatorBps is ${cfg.creatorBps}, expected ${REQUIRED_CREATOR_PCT}`,
    );
  }
  if (cfg.protocolBps !== REQUIRED_PROTOCOL_PCT) {
    throw new Error(
      `ProtocolConfig.protocolBps is ${cfg.protocolBps}, expected ${REQUIRED_PROTOCOL_PCT}`,
    );
  }
  if (
    !cfg.protocolVaultAddress ||
    cfg.protocolVaultAddress === PLACEHOLDER_VAULT
  ) {
    throw new Error(
      `ProtocolConfig.protocolVaultAddress is unset or placeholder. ` +
        `Update the row to the real protocol treasury address.`,
    );
  }

  return {
    creatorBps: cfg.creatorBps,
    protocolBps: cfg.protocolBps,
    protocolVaultAddress: cfg.protocolVaultAddress,
  };
}

/**
 * Read the current protocol vault address. Throws if the row is missing —
 * callers should always call `assertProtocolConfig` at boot first.
 */
export async function getProtocolVaultAddress(): Promise<string> {
  const cfg = await prisma.protocolConfig.findUnique({ where: { id: 1 } });
  if (!cfg) {
    throw new Error("ProtocolConfig row is missing");
  }
  return cfg.protocolVaultAddress;
}

/**
 * Split a fee amount (lamports) per the pinned 80/20 rule. Rounds the
 * creator share down so the sum always equals the input.
 */
export function splitFee(totalLamports: bigint): {
  creatorLamports: bigint;
  protocolLamports: bigint;
} {
  const creatorLamports =
    (totalLamports * BigInt(REQUIRED_CREATOR_PCT)) / BigInt(100);
  const protocolLamports = totalLamports - creatorLamports;
  return { creatorLamports, protocolLamports };
}
