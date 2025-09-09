// lib/metadata/tokenMetadata.ts
export type TokenMeta = {
  mint: string;
  symbol: string;
  name?: string;
  decimals: number;
  logoURI?: string;
  source: 'local' | 'helius' | 'solscan' | 'jupiter' | 'derived';
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const localCache = new Map<string, TokenMeta>();

// Inject SOL locally up-front
localCache.set(SOL_MINT, {
  mint: SOL_MINT,
  symbol: 'SOL',
  name: 'Solana',
  decimals: 9,
  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png',
  source: 'local'
});

// Helper: compact symbol fallback
const short = (m: string) => `${m.slice(0,4)}…${m.slice(-4)}`;

// Try to infer decimals from any transfer payload we already saw
export function inferDecimalsFromTransfer(mint: string, hinted?: number) {
  if (Number.isInteger(hinted) && hinted! >= 0 && hinted! <= 12) {
    const meta = localCache.get(mint);
    if (!meta) {
      localCache.set(mint, {
        mint, symbol: short(mint), decimals: hinted!, source: 'derived'
      } as TokenMeta);
    }
  }
}

// ---- Source 1: Helius token-metadata (batch capable) ----
async function fetchFromHelius(mint: string, apiKey: string): Promise<TokenMeta | null> {
  try {
    const r = await fetch('https://api.helius.xyz/v0/token-metadata', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ mintAccounts: [mint] })
    });
    if (!r.ok) return null;
    const [it] = await r.json();
    if (!it) return null;

    // Helius returns decimals under "onChainAccountInfo.data.parsed.info.decimals" for fungibles
    const decimals =
      it?.onChainAccountInfo?.data?.parsed?.info?.decimals ??
      it?.tokenInfo?.decimals ??
      9;

    const symbol =
      it?.tokenInfo?.symbol ||
      it?.metadata?.symbol ||
      short(mint);

    const name =
      it?.tokenInfo?.name ||
      it?.metadata?.name;

    const logo =
      it?.tokenInfo?.image ||
      it?.offChainMetadata?.metadata?.image;

    return {
      mint, symbol, name, decimals,
      logoURI: logo,
      source: 'helius'
    };
  } catch {
    return null;
  }
}

// ---- Source 2: Solscan (treat 404 as "missing", never throw) ----
async function fetchFromSolscan(mint: string): Promise<TokenMeta | null> {
  try {
    const r = await fetch(`https://public-api.solscan.io/token/meta?tokenAddress=${mint}`, {
      headers: { 'accept': 'application/json' }
    });
    if (r.status === 404) return null; // normal for SOL/pump tokens
    if (!r.ok) return null;
    const j = await r.json();
    const decimals = j.decimals ?? 9;
    const symbol = j.symbol || short(mint);
    return { mint, symbol, name: j.name, decimals, logoURI: j.icon, source: 'solscan' };
  } catch {
    return null;
  }
}

// ---- Source 3: Jupiter token list (optional, nice fallback) ----
let jupIndex: Map<string, any> | null = null;
async function fetchFromJupiter(mint: string): Promise<TokenMeta | null> {
  try {
    if (!jupIndex) {
      const r = await fetch('https://token.jup.ag/all');
      if (!r.ok) return null;
      const arr = await r.json();
      jupIndex = new Map(arr.map((t: any) => [t.address, t]));
    }
    const t = jupIndex.get(mint);
    if (!t) return null;
    return {
      mint,
      symbol: t.symbol || short(mint),
      name: t.name,
      decimals: t.decimals ?? 9,
      logoURI: t.logoURI,
      source: 'jupiter'
    };
  } catch {
    return null;
  }
}

// Main resolver with caching & fallbacks - NEVER THROWS
export async function getTokenMeta(mint: string, heliusKey: string, hintedDecimals?: number): Promise<TokenMeta> {
  const cached = localCache.get(mint);
  if (cached) return cached;

  // Always return a fallback - never throw
  const fallback: TokenMeta = {
    mint,
    symbol: short(mint),
    decimals: hintedDecimals ?? 9,
    source: 'derived'
  };

  try {
    // 1) Helius
    const h = await fetchFromHelius(mint, heliusKey);
    if (h) { localCache.set(mint, h); return h; }

    // 2) Solscan
    const s = await fetchFromSolscan(mint);
    if (s) { localCache.set(mint, s); return s; }

    // 3) Jupiter
    const j = await fetchFromJupiter(mint);
    if (j) { localCache.set(mint, j); return j; }
  } catch (error) {
    // Log but don't throw - always return fallback
    console.warn(`Metadata fetch failed for ${mint}, using fallback:`, error);
  }

  // 4) Last resort: use hinted decimals or 9
  localCache.set(mint, fallback);
  return fallback;
}

// Batch metadata fetching for efficiency - NEVER THROWS
export async function getBatchTokenMeta(mints: string[], heliusKey: string, decimalsHints: Map<string, number> = new Map()): Promise<Map<string, TokenMeta>> {
  const results = new Map<string, TokenMeta>();
  const missing: string[] = [];

  // Process in parallel with allSettled to never fail
  const promises = mints.map(async (mint) => {
    try {
      const hinted = decimalsHints.get(mint);
      const meta = await getTokenMeta(mint, heliusKey, hinted);
      results.set(mint, meta);
      
      if (meta.source === 'derived') {
        missing.push(mint);
      }
    } catch (error) {
      // Individual token failure shouldn't break the batch
      console.warn(`Failed to get metadata for ${mint}:`, error);
      const fallback: TokenMeta = {
        mint,
        symbol: short(mint),
        decimals: decimalsHints.get(mint) ?? 9,
        source: 'derived'
      };
      results.set(mint, fallback);
      missing.push(mint);
    }
  });

  await Promise.allSettled(promises);

  // Single summary log instead of spam
  if (missing.length > 0) {
    console.warn(`Metadata missing for ${missing.length} mints (using fallbacks). Example: ${missing.slice(0,3).join(', ')}`);
  }

  return results;
}
