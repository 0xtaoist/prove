/**
 * Lightweight structured logger.
 *
 * In production (NODE_ENV=production) outputs JSON lines so log aggregators
 * (Datadog, Loki, Railway logs) can parse and query them. In development,
 * falls through to plain console.* for human-readable output.
 *
 * If you later want a full-featured logger (pino, winston), swap the
 * implementation here — all call-sites import from this module.
 */

const IS_PROD = process.env.NODE_ENV === "production";

function jsonLine(level: string, msg: string, extra?: Record<string, unknown>): string {
  return JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg,
    ...extra,
  });
}

export const logger = {
  info(msg: string, extra?: Record<string, unknown>): void {
    if (IS_PROD) {
      process.stdout.write(jsonLine("info", msg, extra) + "\n");
    } else {
      console.log(msg, extra ?? "");
    }
  },

  warn(msg: string, extra?: Record<string, unknown>): void {
    if (IS_PROD) {
      process.stdout.write(jsonLine("warn", msg, extra) + "\n");
    } else {
      console.warn(msg, extra ?? "");
    }
  },

  error(msg: string, extra?: Record<string, unknown>): void {
    if (IS_PROD) {
      process.stderr.write(jsonLine("error", msg, extra) + "\n");
    } else {
      console.error(msg, extra ?? "");
    }
  },
};
