---
name: web3-fullstack-playbook
description: >
  Battle-tested playbook for building full-stack Web3 apps — distilled from 298 commits across smart contract hardening, fee pipeline debugging (V1→V2 migration), gasless transaction patterns, UX psychology, UI system design, deployment guardrails, and security hardening. Use this when starting or running any Web3 project.
---

# Web3 Full-Stack Playbook

> Distilled from 298 commits building a production DeFi platform on Base L2. Every section comes from real bugs, real redesigns, and real money stuck in contracts. This is project-agnostic — adapt the patterns to your stack.

---

## Table of Contents

1. [Smart Contract Hardening](#1-smart-contract-hardening)
2. [Fee Pipeline Architecture — The V2 Lesson](#2-fee-pipeline-architecture--the-v2-lesson)
3. [Gasless Transactions](#3-gasless-transactions)
4. [UX Optimizations](#4-ux-optimizations)
5. [UI System Design](#5-ui-system-design)
6. [Deployment & CI/CD Guardrails](#6-deployment--cicd-guardrails)
7. [Security Hardening](#7-security-hardening)
8. [Auth Integration (Privy/Web3 Auth)](#8-auth-integration-privyweb3-auth)
9. [Refactoring Patterns](#9-refactoring-patterns)
10. [Pre-Launch Checklist](#10-pre-launch-checklist)

---

## 1. Smart Contract Hardening

### 1a. Uniswap Swap Callback Validation (CRITICAL)

> **CAUTION**: V3/V4 swap callbacks are called by the pool, but **anyone** can call your callback directly with forged data.

**Pattern**: Always validate `msg.sender` via the factory's on-chain state:

```solidity
function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
) external {
    (address pool, address t0, address t1) = abi.decode(data, (address, address, address));
    require(msg.sender == pool, "INVALID_CALLER");
    require(v3Factory.getPool(t0, t1, POOL_FEE) == pool, "INVALID_POOL");

    if (amount0Delta > 0) IERC20(t0).transfer(msg.sender, uint256(amount0Delta));
    else if (amount1Delta > 0) IERC20(t1).transfer(msg.sender, uint256(amount1Delta));
    else revert("NO_PAYMENT_DUE");
}
```

**Why dual check**: Callback data is attacker-controlled. `v3Factory.getPool()` is the unforgeable on-chain source of truth.

### 1b. NFT/Position Ownership Verification

> **WARNING**: Never register or track an NFT/LP position without verifying the contract actually owns it.

```solidity
require(positionManager.ownerOf(tokenId) == address(this), "NFT_NOT_OWNED");
```

Phantom positions break fee accounting and can drain legitimate fee pools.

### 1c. Pair/Pool Validation

> **IMPORTANT**: Validate that LP positions are for expected token pairs.

```solidity
if (token0 != expectedBase && token1 != expectedBase) revert("NOT_VALID_PAIR");
```

### 1d. Safe Token Transfers

Non-standard ERC-20s (USDT, BNB) don't return `bool` from `transfer()`. Always use safe wrappers:

```solidity
function _transferToken(address token, address to, uint256 amount) internal {
    (bool success, bytes memory data) = token.call(
        abi.encodeWithSignature("transfer(address,uint256)", to, amount)
    );
    if (!success || (data.length > 0 && !abi.decode(data, (bool)))) {
        revert TransferFailed();
    }
}
```

### 1e. General Contract Rules

| Pattern | Rule |
|---------|------|
| **Callback validation** | Never trust callback data alone — verify against immutable on-chain state |
| **Access control** | Use `onlyFactory`, `onlyOwner` modifiers consistently |
| **Ownership transfer** | Always use 2-step transfer (`transferOwnership` + `acceptOwnership`) |
| **Interface hygiene** | Add `ownerOf()`, `getPool()` etc. to minimal interfaces for validation |
| **State before external** | Follow checks-effects-interactions: validate → update state → external calls |
| **Pause mechanism** | Include `whenNotPaused` on fee collection for emergency stops |
| **Nonce collision** | Add delays between batch transactions from the same wallet |

### 1f. Nonce Collision on Batch Transactions

When sending multiple transactions from the same wallet in quick succession, nonce collisions occur:

```typescript
for (const item of items) {
  await sendTransaction(item);
  await sleep(2000); // Wait for tx to propagate
}
```

### 1g. Auto-Verify on Block Explorer

Every deployed contract should be automatically verified on the block explorer after deployment. This builds trust and lets users read the source code.

---

## 2. Fee Pipeline Architecture — The V2 Lesson

> **This section is the single most expensive lesson — $1,690 stuck in a V1 contract, 10+ commits across 4 days, and a forced contract migration to V2.**

### The Story

The V1 FeeVault had a critical design flaw: **fees were escrowed under a pool ID, but the contract had no way to assign a developer to those escrowed fees after deployment.** The `assignDev()` function wasn't called during the launch flow, and the escrow mechanism had no recovery path.

**Result**: $1,690.46 in escrowed fees were **permanently stuck** in the V1 contract.

### What Went Wrong (V1 → V2 Migration)

| Issue | Root Cause | V2 Fix |
|-------|-----------|--------|
| Fees stuck in escrow | `assignDev()` not called during launch | Call `setDevForPool()` as part of the launch transaction |
| No recovery path | V1 had no admin function to reassign escrowed fees | V2 added `onlyOwner` admin functions for reassignment |
| Wrong dev address | Embedded wallet vs. server wallet confusion | Query ALL user wallet addresses for fee operations |
| Fees routed to wrong mapping | Pool ID ≠ token address ≠ dev address confusion | Clear separation: `poolId → escrow`, `devAddress → claimable` |
| Expired escrow → protocol | 30-day expiry swept unclaimed fees to protocol | Added admin override to extend or reassign before expiry |

### V2 Fee Pipeline Design (The Fix)

```
Swap happens on DEX
  ──▶ Hook/Locker captures fee (in swap token, no forced conversion)
  ──▶ FeeVault.depositFees() splits:
       80% → Dev (if known) or Escrow (if unknown)
       20% → Protocol treasury (ALWAYS)
  ──▶ After verification: setDevForPool() sweeps escrow → dev balance
  ──▶ Dev calls claimDevFees() or backend claims server-side
  ──▶ Token transferred to dev wallet
```

### Fee Pipeline Checklist (For Any Project)

- [ ] Fee split contract has admin functions for reassignment/recovery
- [ ] `assignDev()` or equivalent is called **during the launch transaction**, not after
- [ ] Fee queries check ALL user wallet addresses (embedded + custodial + EOA)
- [ ] NULL/missing `projectId` records are backfilled at startup
- [ ] Use `inArray()` not `ANY()` in ORMs like Drizzle
- [ ] Gas is sponsored for claim transactions (see §3)
- [ ] Server-side claim execution available (no client-side signing needed)
- [ ] Correct contract address + ABI in frontend config
- [ ] Escrow has an admin recovery path (don't rely on users to claim in time)
- [ ] Fee tokens track which tokens a user has earned (array + mapping combo)

### Critical Design Principle

> **Never deploy a fee contract without an admin recovery path for escrowed funds.** If you have an escrow mechanism, you MUST have a way to reassign or sweep those funds after the fact. Otherwise, a single missed function call during launch = money lost forever.

### Fee Accounting Anti-Pattern

```solidity
// ❌ V1 BUG: Only track by pool ID — no way to route to dev later
mapping(bytes32 => uint256) public poolFees;

// ✅ V2 FIX: Track by dev AND by pool, with assignment mechanism
mapping(address => mapping(address => uint256)) public devFees;        // dev => token => amount
mapping(bytes32 => mapping(address => uint256)) public unclaimedFees;  // pool => token => amount
mapping(bytes32 => address) public poolDev;                            // pool => dev address
```

---

## 3. Gasless Transactions

> Users should never need ETH to interact with your protocol. Gas friction kills conversion.

### Pattern: Backend-Sponsored Gas

```typescript
// POST /api/fees/claim — Server-side gasless fee claiming
async function handleClaim(userId: string) {
  const signer = await getUserServerSideWallet(userId);

  // 1. Check if wallet has enough gas
  const balance = await provider.getBalance(signer.address);
  const GAS_AMOUNT = ethers.parseEther("0.0002"); // ~2-3 txs on L2

  // 2. Auto-fund gas from deployer if needed
  if (balance < GAS_AMOUNT) {
    const deployer = getDeployerWallet();
    const gasTx = await deployer.sendTransaction({
      to: signer.address,
      value: GAS_AMOUNT,
    });
    await gasTx.wait();
  }

  // 3. Execute claim transaction server-side
  const contract = new ethers.Contract(vaultAddress, CLAIM_ABI, signer);
  const tx = await contract.claimDevFees(tokenAddress);
  await tx.wait();

  return { success: true, txHash: tx.hash };
}
```

### Gasless Transaction Rules

| Rule | Why |
|------|-----|
| **Rate limit gas funding** | Prevent drain attacks (1 funding/hour/user) |
| **Check balance first** | Skip funding if wallet already has gas |
| **Fund a small amount** | 0.0002 ETH ≈ 2-3 txs on L2, minimizes risk |
| **Use server-side wallets** | User never needs a browser extension or ETH |
| **Deployer wallet singleton** | Cache the wallet instance to avoid repeated init |
| **Wait for confirmation** | `await gasTx.wait()` before executing the main tx |
| **Log everything** | Gas funding and claims should have structured logging |

### Gas Funding Architecture

```
User clicks "Claim Fees" (frontend)
  ──▶ POST /api/fees/claim (authenticated)
  ──▶ Backend checks user's server-side wallet balance
  ──▶ If insufficient: deployer sends 0.0002 ETH
  ──▶ Backend executes claimDevFees() with user's wallet
  ──▶ Tokens transferred to user's wallet
  ──▶ Frontend shows success + tx hash
```

The user never sees gas, never needs ETH, never signs a transaction. Total abstraction.

---

## 4. UX Optimizations

### 4a. Psychology Patterns That Move Metrics

| Pattern | Application | Impact |
|---------|-------------|--------|
| **Fitts's Law** | Larger click targets for primary actions | Higher click rate |
| **Von Restorff Effect** | Primary CTA visually distinct from surroundings | More conversions |
| **Jakob's Law** | UI patterns familiar from other Web3 apps | Lower cognitive load |
| **Miller's Law** | Chunk dashboard data into groups of 5-7 | Better comprehension |
| **Loss Aversion** | Frame unclaimed fees as "money you're leaving" | Higher claim rate |
| **Hick's Law** | Reduce choices via progressive disclosure | Faster decisions |
| **Zeigarnik Effect** | Show endowed progress (Step 1 of 4 ✓) | Higher completion |
| **Peak-End Rule** | Memorable success state after key actions | Better retention |
| **Serial Position** | Most important nav items first and last | Higher engagement |
| **Social Proof** | Show counts, stats, and activity indicators | More trust |
| **Progressive Disclosure** | Show simple first, reveal complexity on demand | Lower bounce |
| **Cognitive Load Theory** | Simplify forms to essential fields | Higher completion |

### 4b. Error Handling UX

```typescript
// ❌ BROKEN — shows [object Object] to users
catch (err) { setError(err) }

// ✅ FIXED — always extract the message string
catch (err) { setError(err instanceof Error ? err.message : String(err)) }
```

### 4c. Multi-Wallet Query Pattern

Users often have multiple wallets (embedded, custodial, EOA). Any query for "user's stuff" must check ALL:

```typescript
const allWallets = [embeddedWallet, custodialWallet, eoaWallet].filter(Boolean);
const projects = await db.query.projects.findMany({
  where: inArray(schema.walletAddress, allWallets),
});
```

### 4d. Loading State Timeout

Third-party auth SDKs can hang forever. Always add a timeout fallback:

```typescript
// Privy, Auth0, etc. — add loading timeout
const [ready, setReady] = useState(false);
useEffect(() => {
  const timer = setTimeout(() => setReady(true), 3000);
  return () => clearTimeout(timer);
}, []);
```

### 4e. AI Agent Anti-Fabrication

If your AI agent claims it performed an on-chain action, **always verify on-chain** before telling the user it succeeded. Agents will sometimes hallucinate success.

### 4f. Confirmation Steps for Destructive Actions

Token launches, key exports, and fund transfers require explicit user confirmation. Ensure the raw user text (not just the parsed intent) is passed to the confirmation handler — intent parsing can strip the confirmation phrase.

---

## 5. UI System Design

### 5a. Performance Optimizations

| Optimization | Pattern |
|-------------|---------|
| **Memoize component lists** | `React.memo` when parent re-renders frequently |
| **Memoize expensive computations** | `useMemo` for filtering, sorting, derived data |
| **Memoize static data** | `useMemo([], [])` for tab definitions, column configs |
| **Batch RPC calls** | Use multicall instead of sequential balance checks |
| **Truncate AI history** | Prevent context window overflow and payload bloat |

```typescript
// ❌ Sequential (slow) — 10 tokens × 200ms = 2s
for (const token of tokens) {
  const balance = await getBalance(token);
}

// ✅ Parallel multicall (fast) — 1 call × 200ms = 200ms
const results = await multicall({ contracts: tokens.map(t => ({
  address: t, abi: erc20Abi, functionName: "balanceOf", args: [wallet]
}))});
```

### 5b. Frontend Bug Patterns

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `[object Object]` in error messages | Setting error to an object, not a string | Extract `.message` from Error objects |
| Authorization header lost | Header spread ordering overwrites auth | Put `Authorization` last in spread |
| React hook order violations | Conditional hook calls in optional features | Context bridge pattern (see §8) |
| Fee display showing $0 | Wrong contract address, stale ABI, or wrong wallet | Verify ALL: address, ABI, wallet |
| Component crash on error | Backend returns unexpected shape | ErrorBoundary around every feature |

### 5c. Component Decomposition Rule

When a file exceeds ~300 lines, decompose by domain concern:

```
engine.ts (800 lines) →
  engine/index.ts       (orchestration)
  engine/tools.ts       (tool definitions)
  engine/helpers.ts     (helper functions)
  engine/llm.ts         (LLM provider abstraction)
```

---

## 6. Deployment & CI/CD Guardrails

### 6a. The Lockfile Wars

> 5 failed deploys before getting this right.

**Rule**: When using multiple package managers (e.g., npm for backend, Bun for frontend), NEVER cross them:

| Directory | Package Manager | Lockfile | Install Command |
|-----------|----------------|----------|-----------------|
| `/` (root) | npm | `package-lock.json` | `npm install` |
| `/web` | Bun | `bun.lock` | `bun install` |

### 6b. Environment Variable Rules

| Rule | Why |
|------|-----|
| Client-side vars MUST have `NEXT_PUBLIC_` prefix | Next.js strips unprefixed vars from bundles |
| `NEXT_PUBLIC_` vars bake at BUILD time | Must redeploy to pick up changes |
| Never commit `.env` files | Use `.env.example` as template |
| Check hosting env vars after every new feature | Missing vars cause silent failures |

### 6c. Post-Refactor Checklist (Mandatory)

After any refactor involving >5 files:

```bash
# 1. TypeScript compilation
npx tsc --noEmit                         # Backend
cd web && npx tsc --noEmit               # Frontend

# 2. Import verification — find broken references
grep -rn "from.*changed-module" src/ web/src/ --include="*.ts" --include="*.tsx"

# 3. Lockfile sync
cd web && bun install && git add bun.lock   # If web packages changed
npm install && git add package-lock.json    # If root packages changed

# 4. Critical path smoke test
# - Auth flow (sign in → dashboard)
# - Core feature (main user action → result)
# - Wallet (view balance, send tx)
```

### 6d. Common Post-Refactor Breakages

| Symptom | Cause | Fix |
|---------|-------|-----|
| `X is not defined` at runtime | Missing import | Add import statement |
| `X is not exported from Y` | Export moved during refactor | Update import path |
| `frozen-lockfile` fails | Stale lockfile | Run `bun install` / `npm install` |
| Build works, app crashes | Runtime import error | Check deploy logs |
| Lint warnings block deploy | Warnings treated as errors | Set `eslint: { ignoreDuringBuilds: true }` |

---

## 7. Security Hardening

### 7a. Vulnerabilities Found & Fixed (Real Examples)

| Vulnerability | Severity | Fix |
|--------------|----------|-----|
| Fallback encryption key in production | **CRITICAL** | Require env var, crash if missing |
| API endpoints expose wallet addresses | **HIGH** | Strip wallet from all public responses |
| Token swap accepts any address | **HIGH** | Reject addresses not in allowlist |
| No slippage tolerance on swaps | **MEDIUM** | Add 1% default slippage |
| Rate limiting bypassed behind proxy | **MEDIUM** | Set `TRUST_PROXY` config |
| Framework CVEs (Next.js) | **HIGH** | Keep updated to latest patch |
| Private key export without confirmation | **HIGH** | Require exact phrase match |

### 7b. Security Architecture (Layers)

1. **Auth middleware** — validate JWT on authenticated routes
2. **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
3. **CORS** — whitelist specific origins only
4. **Rate limiting** — per-IP and per-user with Redis-backed counters
5. **Input validation** — Zod schemas on all request bodies
6. **Composable security pipeline** — chain security checks before handlers

### 7c. Security Rules

1. **NEVER** use fallback encryption keys in production — crash instead
2. **NEVER** expose wallet addresses in public API responses
3. **ALWAYS** require exact phrase confirmation for dangerous actions
4. **ALWAYS** validate token addresses against an allowlist before swaps
5. **ALWAYS** add slippage tolerance to DEX swap quotes
6. **ALWAYS** set `TRUST_PROXY` when behind a reverse proxy
7. **ALWAYS** wrap multi-row database operations in transactions
8. **ALWAYS** keep framework dependencies updated

---

## 8. Auth Integration (Privy/Web3 Auth)

> 12+ commits spanning 3 days of auth integration bugs. These patterns apply to any Web3 auth SDK.

### 8a. React Hook Conditional Call Fix

```tsx
// ❌ BROKEN — conditional hook call
function useOptionalAuth() {
  try {
    const auth = require("@auth-sdk/react-auth");
    return auth.useAuth();  // Hook called conditionally!
  } catch { return null; }
}

// ✅ FIXED — context bridge pattern
const AuthBridge = createContext<AuthState | null>(null);

function AuthBridgeProvider({ children }) {
  const auth = useAuth();  // Always called, unconditionally
  return <AuthBridge.Provider value={auth}>{children}</AuthBridge.Provider>;
}

function useOptionalAuth() {
  return useContext(AuthBridge);  // Safe, no hook rules violation
}
```

### 8b. Auth SDK Rules

1. Use static imports only — no dynamic `require()`
2. Wrap auth SDK in a context bridge provider for optional access
3. CSS z-index override is mandatory for auth modals (`z-index: 2147483647 !important`)
4. Only enable dashboard-configured login methods (including Telegram without setup = silent failure)
5. Auth app IDs/keys bake at build time — redeploy to change
6. Add allowed origins in auth dashboard for every deploy domain
7. Add loading timeout (3s) to prevent infinite "Loading..." states
8. Test auth flow on deployed URL, not just localhost

---

## 9. Refactoring Patterns

### 9a. Extract → Centralize → Delete

1. **Extract** repeated logic into a shared utility
2. **Centralize** all consumers to use the new utility
3. **Delete** the old inline implementations

### 9b. Type Safety Improvements

```typescript
// ❌ Before — stringly typed, error-prone
type Platform = string;
type Result = { success: boolean; data?: any; error?: string };

// ✅ After — discriminated unions, exhaustive checks
type Platform = "github" | "domain" | "twitter" | "facebook";
type Result =
  | { success: true; data: VerificationData }
  | { success: false; error: string };
```

### 9c. Backend Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| In-memory state (Maps/Sets) | Use PostgreSQL or Redis — in-memory dies on redeploy |
| Duplicated registries across files | Centralize to single source of truth |
| Sequential RPC calls for balances | Use multicall to batch into 1 call |
| Multi-row DB updates without transactions | Wrap in a transaction for atomicity |
| Unbounded rate limit maps | Add periodic garbage collection with `setInterval` |

---

## 10. Pre-Launch Checklist

### Infrastructure
- [ ] Production database provisioned (PostgreSQL)
- [ ] Redis instance for sessions/cache/rate-limiting
- [ ] Backend deployed with correct build commands
- [ ] Frontend deployed with correct env vars
- [ ] Custom domain configured with SSL
- [ ] `BASE_URL` and `FRONTEND_URL` set to production domains

### Smart Contracts
- [ ] All contracts deployed to mainnet
- [ ] Contracts verified on block explorer
- [ ] Contract addresses set in env vars
- [ ] Fee vault has admin recovery functions
- [ ] `assignDev()` called during launch flow (not after!)
- [ ] Deployer wallet funded with gas (~0.005 ETH)

### Auth & API Keys
- [ ] Auth SDK configured with production allowed origins
- [ ] Auth app ID set as `NEXT_PUBLIC_` env var
- [ ] OAuth apps have production callback URLs
- [ ] `ENCRYPTION_KEY` set (NO fallback allowed)

### Security
- [ ] No fallback encryption keys
- [ ] No wallet addresses in public API responses
- [ ] Rate limiting enabled with Redis backend
- [ ] CORS whitelist configured
- [ ] Security headers enabled
- [ ] `TRUST_PROXY` set if behind reverse proxy
- [ ] Framework dependencies updated to latest patch

### Monitoring
- [ ] Structured logging enabled
- [ ] Error tracking in place
- [ ] Deploy logs monitored for 5 minutes after each push
- [ ] Database backups configured

---

## Appendix: Full Commit Timeline (Sigil Origin)

| Day | Focus | Key Lessons |
|-----|-------|-------------|
| **Day 1** | Foundation | Architecture plan, verification backend, pool contract, initial deploy |
| **Day 2** | Core features | UI redesign, V4 contracts (Hook, FeeVault, Factory, Token), auth system |
| **Day 3** | Polish & deploy | Platform migration, lockfile wars, OpSec layer, security audit, 40+ refactors |
| **Day 4** | Auth & design | Design system overhaul, auth saga (10+ fixes), real data integration |
| **Day 5** | Fees & ship | Fee pipeline debugging, gasless claims, server-side claiming, final polish |
