import { HeliusTransaction } from './heliusClient'
import { SOL_DECIMALS, SOL_MINT, AMM_PROGRAMS } from './constants'
import { SolscanClient, TokenMetadata } from './solscanClient'
import { prisma } from '@/lib/db/prisma'
import { getBatchTokenMeta, TokenMeta } from '@/lib/metadata/tokenMetadata'

export type WalletEvent = {
  sig: string;
  ts: number;                 // unix seconds
  mint: string;               // SPL mint or SOL_MINT
  decimals: number;
  qty: number;                // +buy / -sell in raw units (not decimals-adjusted)
  side: "BUY" | "SELL";
  feeLamports?: number;       // attach if fee applies to this leg
  linkId?: string;            // for swaps: tie legs together
};

const isSwapTx = (tx: HeliusTransaction, wallet: string) => {
  if (tx.events?.swap) return true;
  if ((tx.instructions ?? []).some(i => i.programId && AMM_PROGRAMS.has(i.programId)))
    return true;
  // Heuristic: simultaneous in/out tokenTransfers for same signature
  const tt = tx.tokenTransfers ?? [];
  const distinctMints = new Set(tt.map(t => t.mint).filter(Boolean));
  return distinctMints.size >= 2 && tt.length >= 2;
};

export class TransactionNormalizer {
  private solscanClient: SolscanClient
  private tokenMetadataCache = new Map<string, TokenMetadata>()

  constructor() {
    this.solscanClient = new SolscanClient()
  }

  async normalizeTransactions(
    transactions: HeliusTransaction[],
    wallet: string
  ): Promise<WalletEvent[]> {
    const allEvents: WalletEvent[] = []

    // First pass: collect all unique token mints and decimal hints
    const tokenMints = new Set<string>()
    const decimalsHints = new Map<string, number>()
    
    for (const tx of transactions) {
      // Add SPL token mints
      for (const t of tx.tokenTransfers ?? []) {
        if (t.mint) {
          tokenMints.add(t.mint)
        }
      }
      // Always include SOL
      tokenMints.add(SOL_MINT)
    }

    // Fetch token metadata using resilient service
    const heliusKey = process.env.HELIUS_API_KEY ?? ""
    const metadataMap = await getBatchTokenMeta(Array.from(tokenMints), heliusKey, decimalsHints)
    
    // Update our cache with the fetched metadata
    for (const [mint, meta] of metadataMap) {
      this.tokenMetadataCache.set(mint, {
        mint: meta.mint,
        symbol: meta.symbol,
        name: meta.name || 'Unknown Token',
        decimals: meta.decimals,
        logoURI: meta.logoURI
      })
    }

    // Second pass: normalize transactions into uniform events
    for (const tx of transactions) {
      const events = this.normalize(tx, wallet)
      allEvents.push(...events)
    }

    return allEvents
  }

  private normalize(tx: HeliusTransaction, wallet: string): WalletEvent[] {
    const out: WalletEvent[] = [];
    const ts = tx.timestamp ?? 0;
    const sig = tx.signature;
    const feeLamports = tx.fee ?? 0;
    const w = wallet.toLowerCase();

    // 1) SPL transfers -> BUY/SELL
    for (const t of tx.tokenTransfers ?? []) {
      if (!t.mint || typeof t.tokenAmount !== "number") continue;
      const from = (t.fromUserAccount ?? "").toLowerCase();
      const to = (t.toUserAccount ?? "").toLowerCase();

      // Get metadata or use fallback
      const metadata = this.tokenMetadataCache.get(t.mint);
      const decimals = metadata?.decimals ?? 9; // Default to 9 if metadata missing

      if (from === w && to !== w) {
        // Sent SPL -> SELL
        out.push({ sig, ts, mint: t.mint, decimals, qty: -t.tokenAmount, side: "SELL" });
      } else if (to === w && from !== w) {
        // Received SPL -> BUY
        out.push({ sig, ts, mint: t.mint, decimals, qty: +t.tokenAmount, side: "BUY" });
      }
    }

    // 2) SOL transfers -> BUY/SELL SOL
    for (const nt of tx.nativeTransfers ?? []) {
      if (typeof nt.amount !== "number") continue;
      const from = (nt.fromUserAccount ?? "").toLowerCase();
      const to = (nt.toUserAccount ?? "").toLowerCase();

      if (from === w && to !== w) {
        // Sent SOL -> SELL SOL
        out.push({ sig, ts, mint: SOL_MINT, decimals: SOL_DECIMALS, qty: -nt.amount /* lamports */, side: "SELL" });
      } else if (to === w && from !== w) {
        // Received SOL -> BUY SOL
        out.push({ sig, ts, mint: SOL_MINT, decimals: SOL_DECIMALS, qty: +nt.amount, side: "BUY" });
      }
    }

    // 3) Swaps: label both legs under one linkId
    if (isSwapTx(tx, wallet)) {
      const linkId = `swap:${sig}`;
      // Mark the last two opposite-direction events as a swap pair, if present
      const legs = out.filter(e => e.sig === sig);
      if (legs.length >= 2) {
        legs.slice(-2).forEach(e => (e.linkId = linkId));
      }
    }

    // 4) Attach fee to the wallet's **sell** leg if we sold something in this tx,
    // otherwise to buy (you may refine this per program semantics)
    const legsThisTx = out.filter(e => e.sig === sig);
    if (feeLamports > 0 && legsThisTx.length) {
      const sell = legsThisTx.find(e => e.side === "SELL");
      (sell ?? legsThisTx[0]).feeLamports = (sell ?? legsThisTx[0]).feeLamports ?? 0;
      (sell ?? legsThisTx[0]).feeLamports! += feeLamports;
    }

    return out;
  }


  async persistWalletEvents(events: WalletEvent[], wallet: string): Promise<void> {
    if (events.length === 0) return

    const dbInserts = events.map((event, index) => {
      const metadata = this.tokenMetadataCache.get(event.mint);
      return {
        id: `${wallet}_${event.sig}_${index}`,
        wallet: wallet,
        signature: event.sig,
        index: index,
        slot: 0, // We don't have slot in the new structure
        blockTime: event.ts,
        program: event.linkId ? 'SWAP' : 'TRANSFER',
        type: event.side,
        direction: event.side,
        tokenMint: event.mint,
        tokenSymbol: metadata?.symbol || 'UNKNOWN',
        tokenDecimals: event.decimals,
        amountRaw: event.qty.toString(),
        amountUi: event.qty / Math.pow(10, event.decimals),
        amountUsd: 0, // Will be filled by price service
        priceUsdAtTx: 0, // Will be filled by price service
        meta: JSON.stringify({
          feeLamports: event.feeLamports,
          linkId: event.linkId,
        }),
      }
    })

    // Use upsert to handle duplicates
    for (const insert of dbInserts) {
      await prisma.walletTx.upsert({
        where: { id: insert.id },
        update: {
          slot: insert.slot,
          blockTime: insert.blockTime,
          program: insert.program,
          type: insert.type,
          direction: insert.direction,
          tokenMint: insert.tokenMint,
          tokenSymbol: insert.tokenSymbol,
          tokenDecimals: insert.tokenDecimals,
          amountRaw: insert.amountRaw,
          amountUi: insert.amountUi,
          amountUsd: insert.amountUsd,
          priceUsdAtTx: insert.priceUsdAtTx,
          meta: insert.meta,
        },
        create: insert,
      })
    }
  }

  async persistRawTransactions(transactions: HeliusTransaction[]): Promise<void> {
    if (transactions.length === 0) return

    const dbInserts = transactions.map(tx => ({
      signature: tx.signature,
      slot: tx.slot,
      blockTime: tx.timestamp,
      json: JSON.stringify(tx),
    }))

    // Use upsert to handle duplicates
    for (const insert of dbInserts) {
      await prisma.rawTx.upsert({
        where: { signature: insert.signature },
        update: {
          slot: insert.slot,
          blockTime: insert.blockTime,
          json: insert.json,
        },
        create: insert,
      })
    }
  }
}

