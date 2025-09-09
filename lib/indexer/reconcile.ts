import { HeliusClient } from './heliusClient'
import { TransactionNormalizer } from './normalize'
import { ReconcileResult } from './types'
import { prisma } from '@/lib/db/prisma'
import { createHash } from 'crypto'

export class ReconciliationManager {
  private heliusClient: HeliusClient
  private normalizer: TransactionNormalizer

  constructor() {
    this.heliusClient = new HeliusClient()
    this.normalizer = new TransactionNormalizer()
  }

  async reconcileSlotRange(
    wallet: string,
    fromSlot: number,
    toSlot: number
  ): Promise<ReconcileResult> {
    console.log(`Reconciling wallet ${wallet} from slot ${fromSlot} to ${toSlot}`)

    const result: ReconcileResult = {
      wallet,
      fromSlot,
      toSlot,
      countRaw: 0,
      countWalletTx: 0,
      hash: '',
      ok: false,
      missingSignatures: [],
    }

    try {
      // Fetch all transactions in the slot range from Helius
      const allTransactions = await this.fetchTransactionsInSlotRange(wallet, fromSlot, toSlot)
      const heliusSignatures = allTransactions.map(tx => tx.signature).sort()
      
      // Get stored transactions in the slot range
      const storedTransactions = await prisma.rawTx.findMany({
        where: {
          slot: {
            gte: fromSlot,
            lte: toSlot,
          },
        },
        select: {
          signature: true,
        },
      })
      const storedSignatures = storedTransactions.map(tx => tx.signature).sort()

      // Get wallet events in the slot range
      const walletEvents = await prisma.walletTx.findMany({
        where: {
          wallet,
          slot: {
            gte: fromSlot,
            lte: toSlot,
          },
        },
      })

      // Compute hashes
      const heliusHash = this.computeSignatureHash(heliusSignatures)
      const storedHash = this.computeSignatureHash(storedSignatures)

      result.countRaw = storedSignatures.length
      result.countWalletTx = walletEvents.length
      result.hash = storedHash

      // Check for missing signatures
      const heliusSigSet = new Set(heliusSignatures)
      const storedSigSet = new Set(storedSignatures)
      result.missingSignatures = heliusSignatures.filter(sig => !storedSigSet.has(sig))

      // Determine if reconciliation is successful
      result.ok = heliusHash === storedHash && result.missingSignatures.length === 0

      // If there are missing signatures, fetch and ingest them
      if (result.missingSignatures.length > 0) {
        console.log(`Found ${result.missingSignatures.length} missing signatures, fetching...`)
        
        const missingTransactions = allTransactions.filter(tx => 
          result.missingSignatures.includes(tx.signature)
        )

        // Persist missing transactions
        await this.normalizer.persistRawTransactions(missingTransactions)

        // Normalize and persist wallet events
        const events = await this.normalizer.normalizeTransactions(missingTransactions, wallet)
        await this.normalizer.persistWalletEvents(events, wallet)

        // Recompute hash after ingesting missing transactions
        const updatedStoredTransactions = await prisma.rawTx.findMany({
          where: {
            slot: {
              gte: fromSlot,
              lte: toSlot,
            },
          },
          select: {
            signature: true,
          },
        })
        const updatedStoredSignatures = updatedStoredTransactions.map(tx => tx.signature).sort()
        result.hash = this.computeSignatureHash(updatedStoredSignatures)
        result.ok = heliusHash === result.hash

        console.log(`Ingested ${missingTransactions.length} missing transactions`)
      }

      // Record audit
      await this.recordAudit(result)

      console.log(`Reconciliation complete: ${result.ok ? 'PASS' : 'FAIL'}`)

    } catch (error) {
      console.error('Reconciliation failed:', error)
      await this.recordAudit(result)
      throw error
    }

    return result
  }

  private async fetchTransactionsInSlotRange(
    wallet: string,
    fromSlot: number,
    toSlot: number
  ): Promise<any[]> {
    const allTransactions: any[] = []
    let before: string | undefined

    // We need to paginate backwards to find all transactions in the slot range
    while (true) {
      const response = await this.heliusClient.getParsedTransactions(wallet, before, 1000)
      
      if (response.items.length === 0) {
        break
      }

      // Filter transactions in the slot range
      const transactionsInRange = response.items.filter(tx => 
        tx.slot >= fromSlot && tx.slot <= toSlot
      )

      allTransactions.push(...transactionsInRange)

      // If we've gone past the slot range, we can stop
      const minSlot = Math.min(...response.items.map(tx => tx.slot))
      if (minSlot < fromSlot) {
        break
      }

      before = response.nextBefore
    }

    return allTransactions
  }

  private computeSignatureHash(signatures: string[]): string {
    const sortedSigs = signatures.sort()
    const combined = sortedSigs.join('')
    return createHash('sha256').update(combined).digest('hex')
  }

  private async recordAudit(result: ReconcileResult): Promise<void> {
    const auditId = `${result.wallet}_${result.fromSlot}_${result.toSlot}_${Date.now()}`
    
    await prisma.reconcileAudit.create({
      data: {
        id: auditId,
        wallet: result.wallet,
        fromSlot: result.fromSlot,
        toSlot: result.toSlot,
        countRaw: result.countRaw,
        countWalletTx: result.countWalletTx,
        hash: result.hash,
        ok: result.ok,
      },
    })
  }

  async reconcileRecentSlots(wallet: string, slotCount = 10000): Promise<ReconcileResult[]> {
    const results: ReconcileResult[] = []

    try {
      // Get the latest verified slot
      const syncState = await prisma.syncState.findUnique({
        where: { wallet },
      })

      if (!syncState || !syncState.verifiedSlot) {
        throw new Error(`No verified slot found for wallet ${wallet}`)
      }

      const latestSlot = syncState.verifiedSlot
      const fromSlot = Math.max(0, latestSlot - slotCount)

      console.log(`Reconciling recent slots ${fromSlot} to ${latestSlot} for wallet ${wallet}`)

      // Reconcile in chunks to avoid overwhelming the system
      const chunkSize = 1000
      for (let start = fromSlot; start <= latestSlot; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, latestSlot)
        
        const result = await this.reconcileSlotRange(wallet, start, end)
        results.push(result)

        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 100))
      }

    } catch (error) {
      console.error('Recent slots reconciliation failed:', error)
      throw error
    }

    return results
  }

  async getReconciliationHistory(wallet: string, limit = 10): Promise<any[]> {
    return prisma.reconcileAudit.findMany({
      where: { wallet },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
