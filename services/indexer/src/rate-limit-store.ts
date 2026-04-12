import type { Store } from "express-rate-limit";

/**
 * Returns a Redis-backed rate-limit store when REDIS_URL is set,
 * otherwise null (falls back to in-memory default).
 *
 * Uses a lightweight Map-based Redis adapter so we don't add a
 * heavy dependency. For production with multiple replicas, set
 * REDIS_URL to share rate-limit state across instances.
 */
export function createRateLimitStore(): Store | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[rate-limit] REDIS_URL not set — rate limiting uses in-memory store. " +
          "Set REDIS_URL for distributed rate limiting across replicas.",
      );
    }
    return null;
  }

  // Lazy-require so the redis dependency is optional at dev time.
  // The `as any` casts avoid needing @types/rate-limit-redis and @types/redis
  // installed as dev dependencies — the try/catch handles missing packages.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const { RedisStore } = require("rate-limit-redis") as any;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const { createClient } = require("redis") as any;

    const client = createClient({ url: redisUrl });
    client.connect().catch((err: unknown) => {
      console.error("[rate-limit] Redis connection failed:", err);
    });

    console.log("[rate-limit] Using Redis-backed store");
    return new RedisStore({ sendCommand: (...args: string[]) => client.sendCommand(args) });
  } catch {
    console.warn(
      "[rate-limit] rate-limit-redis or redis package not installed — using in-memory store",
    );
    return null;
  }
}
