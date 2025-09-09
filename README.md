# FadeAI (Initial Commit)

Analyze a Solana wallet and reconstruct trading activity to estimate realized P/L, open positions, and per-token lots.

This **initial commit** captures a working UI and end-to-end ingestion pipeline using Helius REST (v0). It focuses on **buy/sell/swap normalization** and **lot reconstruction**; price modeling is stubbed and will be layered in next.

---

## What Works Today

### ✅ Data Ingestion
- Helius REST `v0/addresses/{wallet}/transactions` backfill with pagination (`before` cursor).
- Robust logging: request URL, response code, timing, preview keys.
- Single-flight guard to prevent duplicate concurrent analyses of the same wallet.

### ✅ Parsing & Normalization
- Combines `tokenTransfers`, `nativeTransfers`, `instructions`, and `events.swap` to emit:
  - **SOL native transfers**
  - **SPL token buys/sells**
  - **Swaps** (Raydium, Jupiter, etc.)
- Reconstructs **FIFO lots** per token.

### ✅ Reconstruction Output
- Per-token activity counts and **per-lot rows** (buy date, quantity).
- Global summary cards render (Realized P/L, Peak Potential, Regret Gap, Open Positions).
- Handles unknown tokens gracefully (no UI crash).

### ✅ Metadata Handling
- Many pump tokens return **404** from Solscan — treated as **non-fatal**.
- Fallback symbol/decimals (ticker short-hash + default decimals) so rows still render.
- Hardcoded SOL mint metadata to avoid 404 noise.

### ✅ UI/UX
- Clean results page showing tokens and expandable **lot details**.
- "Request already in flight" lock + status logs to avoid double work.
- Works on **Next.js 15**, with dev server hot reload.

---

## Known Gaps / Next Up

1. **USD Pricing**
   - Cost basis at buy time (USD).
   - Realized P/L on sells (FIFO).
   - Peak potential and current value.
   - Plan: CoinGecko for **SOL/USD**, Birdeye for **SPL candles**, fallback to **swap-derived price**.

2. **Live Price Refresh**
   - Add a lightweight price cache and periodic refresh for open positions.

3. **More Swap Decoders**
   - Expand coverage for edge routers/pools and fee accounting.

4. **Performance**
   - Batch price lookups and memoize by `mint+day`.
   - Persist backfills (file/db) to skip re-downloading.

---

## Getting Started

### Prereqs
- Node 18+ recommended.
- A **Helius API Key**.

### Setup

Create an `.env.local`:

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
* The app:

  1. Backfills all transactions through Helius REST.
  2. Normalizes buys/sells/swaps and rebuilds per-token FIFO lots.
  3. Renders the **Token Analysis** table and expandable **Lot Details**.

### Troubleshooting

* **"invalid api key provided"** seen in a browser tab usually means you hit the **JSON-RPC** endpoint by mistake. Use the REST path:

  ```
  https://api.helius.xyz/v0/addresses/{WALLET}/transactions?api-key=KEY&maxSupportedTransactionVersion=0
  ```
* If the UI says "Invalid Solana wallet address," ensure the address is base58 (32–44 chars) and not pasted with spaces.
* Solscan 404s on random mints are normal; the UI will still render with fallbacks.

---

## Scripts

* `npm run dev` – start Next.js dev server
* (future) `npm run test` – unit tests for normalization & pricing

---

## License

MIT (c) 2025