# FadeAI

Analyze a Solana wallet using Helius-only data, reconstruct trading activity, estimate simple P&L, and render a clean UI. Includes structured JSON logging for algorithm testing.

---

## What Works Today

### ✅ Data Ingestion
- Helius REST `v0/addresses/{wallet}/transactions` backfill with pagination (`before` cursor).
- Single-flight guard (LRU + in-flight) to prevent duplicate concurrent analyses.
- Deduplication by signature.
- Whole-wallet history fetch works; UI lists a simplified view for the first 100 transactions by default for performance.

### ✅ Parsing & Normalization
- Combines `tokenTransfers`, `nativeTransfers`, `instructions`, and `events.swap` to emit:
  - **SOL native transfers**
  - **SPL token buys/sells**
  - **Swaps** (Raydium, Jupiter, etc.)
- Reconstructs **FIFO lots** per token.

### ✅ P&L and Reconstruction Output
- Simple P&L estimation with pre-fetched prices (parallel).
- Per-token activity counts and **per-lot rows** (buy date, quantity).
- Open positions calculated correctly in UI units (lamports → SOL) to avoid trillions bug.
- Handles unknown tokens gracefully (no UI crash).

### ✅ Metadata Handling
- Many pump tokens return **404** — treated as **non-fatal**.
- Fallback symbol/decimals so rows still render.

### ✅ UI/UX
- Clean results and a Recent Transactions table (first 100 by default).
- Each transaction row shows token ticker and a link to Solscan.
- Works on **Next.js 15**, with dev server hot reload.

### ✅ Structured Logging (Dev Only)
- Full numeric JSON of all transfers (lamports and SOL), fees, slots, timestamps.
- Summary table totals.

---

## Known Gaps / Next Up

1. **Distinguish Trades vs Transfers (in progress)**
   - Implemented: classification for `internal_transfer`, `cash_out`, `cash_in`, and `trade` with optional inclusion via `INCLUDE_INTERNAL_TRANSFERS=true`.
   - Implemented: auto-discovery of linked wallets (bilateral flow) and explicit `linked=addr1,addr2` parameter.
   - Next: expand known exchange hot wallet list (remote/cached source), improve heuristics.

2. **Pricing coverage**
   - Parallel pre-fetch of current prices (fallback default for SOL).
   - Next: robust historical pricing per tx; fallback to implied swap price; caching.

2. **Live Price Refresh**
   - Add a lightweight price cache and periodic refresh for open positions.

3. **More Swap Decoders**
   - Expand coverage for edge routers/pools and fee accounting.

4. **Performance**
   - Whole-wallet fetch works; simplified list shows first 100 tx for responsiveness.
   - Next: streaming paging on the UI and background prefetch for free API keys.

---

## Getting Started

### Prereqs
- Node 18+ recommended.
- A **Helius API Key**.

### Setup

Create an `.env.local` (or edit `env.example` and copy):

```bash
HELIUS_API_KEY=YOUR_HELIUS_KEY
# optional for pricing (future step):
# BIRDEYE_API_KEY=YOUR_BIRDEYE_KEY
```

Install deps and run:

```bash
npm install
npm run dev
# Default: http://localhost:3000 (auto-falls back to 3001 if busy)
```

### Usage

* Enter a Solana wallet address on the home page and click **Analyze**.
* Optional query params for the API route:
  - `limit=1000` – cap transactions fetched (default 0 = unlimited)
  - `skipPnl=true` – fast response without P&L
  - `linked=ADDR1,ADDR2` – explicit linked wallets
  - `autoLink=false` – disable linked-wallet heuristics
  - `INCLUDE_INTERNAL_TRANSFERS=true` (env) – show self/cash transfers in P&L logs

### Troubleshooting

* **"invalid api key provided"** seen in a browser tab usually means you hit the **JSON-RPC** endpoint by mistake. Use the REST path:

  ```
  https://api.helius.xyz/v0/addresses/{WALLET}/transactions?api-key=KEY&maxSupportedTransactionVersion=0
  ```
* If the UI says "Invalid Solana wallet address," ensure the address is base58 (32–44 chars) and not pasted with spaces.
* Solscan 404s on random mints are normal; the UI will still render with fallbacks.

---

## Scripts

### One-liners
- `./setup.sh` (macOS/Linux): cleans install, ensures Prisma DB, runs dev server. Then click the `http://localhost:3000` link in terminal.
- `setup.bat` (Windows): same behavior on Windows.

### NPM
- `npm run dev` – start Next.js dev server
- `npm run test` – unit tests (some suites included)

Prisma is initialized during `setup.sh` / `setup.bat` via `prisma generate` and `prisma db push`.

---

## Status Summary for Commit

- Full transaction history ingestion confirmed; simplified UI renders first 100 rows (trackable) and working to expand across full wallets with free API keys.
- P&L estimation uses pre-fetched prices and excludes internal/cash-out transfers by default.
- Fixed open-positions unit mismatch (lamports vs SOL).

## Roadmap (Next)

1) Improve exchange detection (curated lists, remote source, caching)
2) Historical pricing and implied swap prices
3) Pagination + streaming results in UI
4) Advanced UI/UX once back-end algorithms are complete (filters, charts, per-token P&L)

## License

MIT (c) 2025