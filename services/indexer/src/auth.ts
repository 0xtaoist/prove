import { Request, Response, NextFunction } from "express";
import { PrivyClient } from "@privy-io/server-auth";
import { errorResponse } from "@prove/common";

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient | null {
  if (privyClient) return privyClient;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    console.warn("[auth] NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_SECRET not set — auth disabled");
    return null;
  }
  privyClient = new PrivyClient(appId, appSecret);
  return privyClient;
}

export interface AuthenticatedRequest extends Request {
  privyUserId?: string;
}

/**
 * Middleware that verifies the Privy access token from the Authorization header.
 * If Privy credentials are not configured (dev mode), the request is allowed through
 * without authentication.
 */
export async function requirePrivyAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const client = getPrivyClient();
  if (!client) {
    if (process.env.DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production") {
      // Dev mode only: explicit opt-in to skip auth via DISABLE_AUTH=true
      console.warn("[auth] DISABLE_AUTH=true — skipping authentication (dev only)");
      next();
      return;
    }
    res.status(503).json(errorResponse("Authentication service not configured"));
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json(errorResponse("Missing or malformed Authorization header"));
    return;
  }

  const token = authHeader.slice(7);
  try {
    const claims = await client.verifyAuthToken(token);
    req.privyUserId = claims.userId;
    next();
  } catch {
    res.status(401).json(errorResponse("Invalid or expired access token"));
  }
}
