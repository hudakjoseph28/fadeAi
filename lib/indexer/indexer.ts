import { PaginationManager } from './pagination'
import { ReconciliationManager } from './reconcile'
import { IndexerStats } from './types'
import { prisma } from '@/lib/db/prisma'

export class SolanaIndexer {
  private paginationManager: PaginationManager
  private reconciliationManager: ReconciliationManager

  constructor() {
    this.paginationManager = new PaginationManager()
    this.reconciliationManager = new ReconciliationManager()
  }

  async backfillWallet(wallet: string, maxPages?: number): Promise<IndexerStats> {
    console.log(`Starting backfill for wallet: ${wallet}`)
    
    try {
      const stats = await this.paginationManager.backfillWallet(wallet, maxPages)
      
      // Run reconciliation on the backfilled data
      console.log('Running reconciliation after backfill...')
      await this.reconciliationManager.reconcileRecentSlots(wallet, 10000)
      
      console.log('Backfill completed successfully')
      return stats
    } catch (error) {
      console.error('Backfill failed:', error)
      throw error
    }
  }

  async syncTail(wallet: string): Promise<IndexerStats> {
    console.log(`Starting tail sync for wallet: ${wallet}`)
    
    try {
      const stats = await this.paginationManager.syncTail(wallet)
      
      // Run reconciliation on recent slots after tail sync
      if (stats.rawTxCount > 0) {
        console.log('Running reconciliation after tail sync...')
        await this.reconciliationManager.reconcileRecentSlots(wallet, 1000)
      }
      
      console.log('Tail sync completed successfully')
      return stats
    } catch (error) {
      console.error('Tail sync failed:', error)
      throw error
    }
  }

  async getIndexerStatus(wallet: string): Promise<{
    syncState: any
    rawTxCount: number
    walletTxCount: number
    recentAudits: any[]
  }> {
    const syncState = await prisma.syncState.findUnique({
      where: { wallet },
    })

    const rawTxCount = await prisma.rawTx.count()
    
    const walletTxCount = await prisma.walletTx.count({
      where: { wallet },
    })

    const recentAudits = await this.reconciliationManager.getReconciliationHistory(wallet, 5)

    return {
      syncState,
      rawTxCount,
      walletTxCount,
      recentAudits,
    }
  }

  async runScheduledReconciliation(wallet: string): Promise<void> {
    console.log(`Running scheduled reconciliation for wallet: ${wallet}`)
    
    try {
      const results = await this.reconciliationManager.reconcileRecentSlots(wallet, 10000)
      
      const failedReconciliations = results.filter(r => !r.ok)
      if (failedReconciliations.length > 0) {
        console.warn(`Found ${failedReconciliations.length} failed reconciliations`)
        for (const result of failedReconciliations) {
          console.warn(`Failed reconciliation: slots ${result.fromSlot}-${result.toSlot}, missing: ${result.missingSignatures.length}`)
        }
      } else {
        console.log('All reconciliations passed')
      }
    } catch (error) {
      console.error('Scheduled reconciliation failed:', error)
      throw error
    }
  }

  async getWalletMetrics(wallet: string): Promise<{
    totalTransactions: number
    totalEvents: number
    eventTypes: Record<string, number>
    topTokens: Array<{ tokenMint: string; symbol: string; count: number }>
    recentActivity: any[]
  }> {
    const totalTransactions = await prisma.rawTx.count()
    
    const totalEvents = await prisma.walletTx.count({
      where: { wallet },
    })

    // Get event type breakdown
    const eventTypeStats = await prisma.walletTx.groupBy({
      by: ['type'],
      where: { wallet },
      _count: { type: true },
    })

    const eventTypes = eventTypeStats.reduce((acc, stat) => {
      acc[stat.type] = stat._count.type
      return acc
    }, {} as Record<string, number>)

    // Get top tokens by activity
    const topTokens = await prisma.walletTx.groupBy({
      by: ['tokenMint', 'tokenSymbol'],
      where: { 
        wallet,
        tokenMint: { not: null },
      },
      _count: { tokenMint: true },
      orderBy: { _count: { tokenMint: 'desc' } },
      take: 10,
    })

    const topTokensFormatted = topTokens.map(token => ({
      tokenMint: token.tokenMint!,
      symbol: token.tokenSymbol || 'UNKNOWN',
      count: token._count.tokenMint,
    }))

    // Get recent activity
    const recentActivity = await prisma.walletTx.findMany({
      where: { wallet },
      orderBy: { slot: 'desc' },
      take: 10,
      select: {
        signature: true,
        slot: true,
        blockTime: true,
        type: true,
        direction: true,
        tokenSymbol: true,
        amountUi: true,
      },
    })

    return {
      totalTransactions,
      totalEvents,
      eventTypes,
      topTokens: topTokensFormatted,
      recentActivity,
    }
  }
}

// Export singleton instance
export const indexer = new SolanaIndexer()
