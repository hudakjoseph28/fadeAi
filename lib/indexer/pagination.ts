import { HeliusClient } from './heliusClient'
import { TransactionNormalizer } from './normalize'
import { IndexerStats } from './types'
import { ApiHttpError } from './errors'
import { prisma } from '@/lib/db/prisma'

export class PaginationManager {
  private heliusClient: HeliusClient
  private normalizer: TransactionNormalizer

  constructor() {
    this.heliusClient = new HeliusClient()
    this.normalizer = new TransactionNormalizer()
  }

  async backfillWallet(wallet: string, maxPages?: number): Promise<IndexerStats> {
    const startTime = Date.now()
    const stats: IndexerStats = {
      pagesFetched: 0,
      rawTxCount: 0,
      walletTxCount: 0,
      retryCount: 0,
      durationMs: 0,
      lastBefore: null,
      verifiedSlot: null,
      firstSlot: null,
      lastSlot: null,
    }

    try {
      // Get or create sync state
      let syncState = await prisma.syncState.findUnique({
        where: { wallet },
      })

      if (!syncState) {
        syncState = await prisma.syncState.create({
          data: {
            id: `wallet:${wallet}`,
            wallet,
            lastBefore: null,
            verifiedSlot: null,
            fullScanAt: null,
          },
        })
      }

      let before = syncState.lastBefore ?? undefined
      let cursorReset = false
      const maxPagesLimit = maxPages || parseInt(process.env.MAX_PAGES || '1000')

      console.log(`Starting backfill for wallet ${wallet}, max pages: ${maxPagesLimit}, initial before: ${before || 'none'}`)

      for (let page = 1; page <= maxPagesLimit; page++) {
        try {
          const t0 = Date.now()
          const { items, nextBefore } = await this.heliusClient.getParsedTransactions(wallet, before, 1000)

          // Safety check for items
          if (!items || !Array.isArray(items)) {
            console.error('Invalid response from Helius: items is not an array', { items, nextBefore })
            break
          }

          // Update stats
          stats.pagesFetched++
          stats.rawTxCount += items.length

          // Track slot range
          const slots = items.map(tx => tx.slot)
          if (stats.firstSlot === null) {
            stats.firstSlot = Math.max(...slots)
          }
          stats.lastSlot = Math.min(...slots)

          // Persist raw transactions (idempotent upserts)
          await this.normalizer.persistRawTransactions(items)

          // Normalize and persist wallet events (idempotent)
          const events = await this.normalizer.normalizeTransactions(items, wallet)
          await this.normalizer.persistWalletEvents(events, wallet)
          
          stats.walletTxCount += events.length

          console.log({
            phase: "backfill",
            wallet,
            page,
            count: items.length,
            nextBefore: nextBefore ?? "none",
            status: 200,
            durationMs: Date.now() - t0,
          });

          if (!items.length) {
            console.log("No more transactions found, backfill complete");
            break;
          }

          if (nextBefore) {
            before = nextBefore;
            await prisma.syncState.update({
              where: { id: `wallet:${wallet}` },
              data: { lastBefore: before },
            });
            stats.lastBefore = before
            continue; // PAGE AGAIN
          } else {
            console.log("No nextBefore cursor, likely at the end");
            break;
          }

          const lowestSlot = Math.min(...slots)
          await prisma.syncState.update({
            where: { wallet },
            data: {
              verifiedSlot: lowestSlot,
            },
          })
          stats.verifiedSlot = lowestSlot

              } catch (e: any) {
                const msg = e instanceof Error ? e.message : String(e);
                if (e instanceof ApiHttpError && e.status === 400 && /invalid before/i.test(msg)) {
                  console.warn("Self-healing: bad cursor detected, resetting before cursor once");
                  if (!cursorReset) {
                    before = undefined;     // clear bad cursor and retry SAME page
                    cursorReset = true;
                    page--;                 // stay on same page count
                    continue;
                  }
                }
                console.error(`Error on page ${page}: ${msg}`);
                break;
              }
      }

      // Mark full scan as complete
      await prisma.syncState.update({
        where: { wallet },
        data: {
          fullScanAt: new Date(),
        },
      })

      stats.durationMs = Date.now() - startTime
      console.log(`Backfill complete: ${stats.pagesFetched} pages, ${stats.rawTxCount} raw txs, ${stats.walletTxCount} wallet events in ${stats.durationMs}ms`)

    } catch (error) {
      console.error('Backfill failed:', error)
      stats.durationMs = Date.now() - startTime
      throw error
    }

    return stats
  }

  async syncTail(wallet: string): Promise<IndexerStats> {
    const startTime = Date.now()
    const stats: IndexerStats = {
      pagesFetched: 0,
      rawTxCount: 0,
      walletTxCount: 0,
      retryCount: 0,
      durationMs: 0,
      lastBefore: null,
      verifiedSlot: null,
      firstSlot: null,
      lastSlot: null,
    }

    try {
      // Get sync state
      const syncState = await prisma.syncState.findUnique({
        where: { wallet },
      })

      if (!syncState) {
        throw new Error(`No sync state found for wallet ${wallet}. Run backfill first.`)
      }

      console.log(`Starting tail sync for wallet ${wallet}`)

      // Fetch recent transactions (without 'before' parameter to get newest)
      const pageStartTime = Date.now()
      const response = await this.heliusClient.getParsedTransactions(wallet, undefined, 1000)
      
      if (response.items.length === 0) {
        console.log('No recent transactions found')
        return stats
      }

      // Process transactions in order and stop at first already-seen signature
      const newTransactions = []
      
      for (const tx of response.items) {
        // Check if this signature already exists
        const existing = await prisma.rawTx.findUnique({
          where: { signature: tx.signature },
          select: { signature: true },
        })
        
        if (existing) {
          console.log(`Hit existing signature ${tx.signature}, stopping tail sync`)
          break
        }
        
        newTransactions.push(tx)
      }

      if (newTransactions.length === 0) {
        console.log('No new transactions found')
        return stats
      }

      console.log(`Found ${newTransactions.length} new transactions`)

      // Update stats
      stats.pagesFetched = 1
      stats.rawTxCount = newTransactions.length

      // Track slot range
      const slots = newTransactions.map(tx => tx.slot)
      stats.firstSlot = Math.max(...slots)
      stats.lastSlot = Math.min(...slots)

      // Persist new transactions (idempotent upserts)
      await this.normalizer.persistRawTransactions(newTransactions)

      // Normalize and persist wallet events (idempotent)
      const events = await this.normalizer.normalizeTransactions(newTransactions, wallet)
      await this.normalizer.persistWalletEvents(events, wallet)
      
      stats.walletTxCount = events.length

      // Update sync state
      const highestSlot = Math.max(...slots)
      await prisma.syncState.update({
        where: { wallet },
        data: {
          verifiedSlot: highestSlot,
        },
      })

      stats.verifiedSlot = highestSlot

      const pageDuration = Date.now() - pageStartTime
      stats.durationMs = Date.now() - startTime
      
      console.log(`{ phase: 'tail', wallet: '${wallet}', page: 1, count: ${newTransactions.length}, status: 200, durationMs: ${pageDuration} }`)
      console.log(`Tail sync complete: ${stats.rawTxCount} new txs, ${stats.walletTxCount} events in ${stats.durationMs}ms`)

    } catch (error) {
      console.error('Tail sync failed:', error)
      stats.durationMs = Date.now() - startTime
      throw error
    }

    return stats
  }
}
