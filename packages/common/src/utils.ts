import { PublicKey } from "@solana/web3.js";

/**
 * Recursively convert all BigInt values to strings for safe JSON serialization.
 * JSON.stringify throws on BigInt; this must be applied before sending responses.
 */
export function serializeBigInts(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

/**
 * Validate that a string is a valid Solana base58 public key (32 bytes).
 * Returns true if valid, false otherwise.
 */
export function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) {
    return false;
  }
  try {
    const key = new PublicKey(address);
    // Round-trip check: ensures the input is canonical base58 for a 32-byte key
    return key.toBase58() === address;
  } catch {
    return false;
  }
}

/**
 * Standard error response shape for all API endpoints.
 */
export function errorResponse(message: string): { error: string } {
  return { error: message };
}
