import type {
  FeedToken,
  Auction,
  TokenStats,
  ProveScore,
  CreatorDashboard,
  Quest,
} from "@prove/common";

const BASE_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000";

/** Parse JSON while reviving string-encoded bigints for known amount fields. */
function reviveBigInts(_key: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^\d+$/.test(value) &&
    value.length > 15
  ) {
    return BigInt(value);
  }
  return value;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 10 },
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 404) {
      throw new Error("Not found");
    }
    throw new Error(`Request failed (${status})`);
  }

  const text = await res.text();
  return JSON.parse(text, reviveBigInts) as T;
}

/** Fetch the ranked token feed. */
export function fetchFeed(): Promise<FeedToken[]> {
  return apiFetch<FeedToken[]>("/feed");
}

/** Fetch a single auction by mint address. */
export function fetchAuction(mint: string): Promise<Auction> {
  return apiFetch<Auction>(`/auctions/${encodeURIComponent(mint)}`);
}

/** Fetch all currently active auctions. */
export function fetchActiveAuctions(): Promise<Auction[]> {
  return apiFetch<Auction[]>("/auctions?state=gathering");
}

/** Fetch token stats by mint address. */
export function fetchToken(mint: string): Promise<TokenStats> {
  return apiFetch<TokenStats>(`/tokens/${encodeURIComponent(mint)}`);
}

/** Fetch a user's prove profile / score. */
export function fetchProfile(wallet: string): Promise<ProveScore> {
  return apiFetch<ProveScore>(`/profiles/${encodeURIComponent(wallet)}`);
}

/** Fetch creator dashboard data. */
export function fetchCreator(wallet: string): Promise<CreatorDashboard> {
  return apiFetch<CreatorDashboard>(`/creators/${encodeURIComponent(wallet)}`);
}

/** Fetch quests for a token. */
export function fetchQuests(mint: string): Promise<Quest[]> {
  return apiFetch<Quest[]>(`/tokens/${encodeURIComponent(mint)}/quests`);
}

/**
 * Register (or update) the creator row for the given wallet. Called from the
 * launch flow BEFORE the on-chain create_auction so that the indexer has a
 * Creator row to FK against once AuctionCreated lands. Idempotent.
 *
 * @param accessToken - Privy access token from `usePrivy().getAccessToken()`.
 *   Required in production; the indexer validates this via `requirePrivyAuth`.
 */
export async function registerCreator(
  input: {
    wallet: string;
    email?: string | null;
    handle?: string | null;
  },
  accessToken: string | null,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${BASE_URL}/api/creators`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`registerCreator failed (${res.status})`);
  }
}

/**
 * Upload token metadata (name, description, image) to the indexer.
 * Returns the metadata URI to use in the on-chain Metaplex metadata.
 */
export async function uploadTokenMetadata(
  input: {
    mint: string;
    name: string;
    description: string;
    image: File | null;
  },
  accessToken: string | null,
): Promise<string> {
  let imageData: string | null = null;

  if (input.image) {
    // Convert File to base64 data URI
    const buffer = await input.image.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
    );
    imageData = `data:${input.image.type};base64,${base64}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${BASE_URL}/api/metadata/upload`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mint: input.mint,
      name: input.name,
      description: input.description,
      image: imageData,
    }),
  });

  if (!res.ok) {
    throw new Error(`uploadTokenMetadata failed (${res.status})`);
  }

  const data = await res.json();
  return data.metadataUri;
}
