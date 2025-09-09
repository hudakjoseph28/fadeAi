import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaginationManager } from '@/lib/indexer/pagination'
import { HeliusClient } from '@/lib/indexer/heliusClient'
import { TransactionNormalizer } from '@/lib/indexer/normalize'
import { prisma } from '@/lib/db/prisma'

// Mock the dependencies
vi.mock('@/lib/indexer/heliusClient')
vi.mock('@/lib/indexer/normalize')
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    syncState: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    rawTx: {
      findUnique: vi.fn(),
    },
  },
}))

describe('PaginationManager - Tail Sync', () => {
  let paginationManager: PaginationManager
  let mockHeliusClient: any
  let mockNormalizer: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockHeliusClient = {
      getParsedTransactions: vi.fn(),
    }
    
    mockNormalizer = {
      persistRawTransactions: vi.fn(),
      normalizeTransactions: vi.fn(),
      persistWalletEvents: vi.fn(),
    }

    vi.mocked(HeliusClient).mockImplementation(() => mockHeliusClient)
    vi.mocked(TransactionNormalizer).mockImplementation(() => mockNormalizer)

    paginationManager = new PaginationManager()
  })

  it('should stop at first existing signature', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    // Mock existing sync state
    ;(prisma.syncState.findUnique as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: 'old_cursor',
      verifiedSlot: 1000,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    // Mock transactions: newest first (from Helius)
    const allTransactions = [
      {
        signature: 'new_sig_1', // New
        slot: 1003,
        blockTime: 1234567893,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['new_sig_1'] },
        version: 0,
      },
      {
        signature: 'new_sig_2', // New
        slot: 1002,
        blockTime: 1234567892,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['new_sig_2'] },
        version: 0,
      },
      {
        signature: 'existing_sig', // Already exists - should stop here
        slot: 1001,
        blockTime: 1234567891,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['existing_sig'] },
        version: 0,
      },
      {
        signature: 'old_sig', // Would be skipped due to stop
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['old_sig'] },
        version: 0,
      },
    ]

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: allTransactions,
      nextBefore: 'old_sig',
    })

    // Mock database lookups - only 'existing_sig' exists
    ;(prisma.rawTx.findUnique as any).mockImplementation(({ where }) => {
      if (where.signature === 'existing_sig') {
        return Promise.resolve({ signature: 'existing_sig' })
      }
      return Promise.resolve(null)
    })

    mockNormalizer.normalizeTransactions.mockResolvedValue([
      {
        wallet,
        signature: 'new_sig_1',
        index: 0,
        slot: 1003,
        blockTime: 1234567893,
        program: null,
        type: 'UNKNOWN',
        direction: 'N/A',
        tokenMint: null,
        tokenSymbol: null,
        tokenDecimals: null,
        amountRaw: null,
        amountUi: null,
        amountUsd: null,
        priceUsdAtTx: null,
        meta: null,
      },
      {
        wallet,
        signature: 'new_sig_2',
        index: 0,
        slot: 1002,
        blockTime: 1234567892,
        program: null,
        type: 'UNKNOWN',
        direction: 'N/A',
        tokenMint: null,
        tokenSymbol: null,
        tokenDecimals: null,
        amountRaw: null,
        amountUi: null,
        amountUsd: null,
        priceUsdAtTx: null,
        meta: null,
      },
    ])

    ;(prisma.syncState.update as any).mockResolvedValue({})

    const stats = await paginationManager.syncTail(wallet)

    // Verify correct API call (no before parameter for tail sync)
    expect(mockHeliusClient.getParsedTransactions).toHaveBeenCalledWith(wallet, undefined, 1000)

    // Verify database checks for each transaction in order
    expect(prisma.rawTx.findUnique).toHaveBeenCalledTimes(3)
    expect(prisma.rawTx.findUnique).toHaveBeenNthCalledWith(1, {
      where: { signature: 'new_sig_1' },
      select: { signature: true },
    })
    expect(prisma.rawTx.findUnique).toHaveBeenNthCalledWith(2, {
      where: { signature: 'new_sig_2' },
      select: { signature: true },
    })
    expect(prisma.rawTx.findUnique).toHaveBeenNthCalledWith(3, {
      where: { signature: 'existing_sig' },
      select: { signature: true },
    })

    // Should have persisted only the 2 new transactions
    expect(mockNormalizer.persistRawTransactions).toHaveBeenCalledWith([
      allTransactions[0], // new_sig_1
      allTransactions[1], // new_sig_2
    ])

    expect(stats.rawTxCount).toBe(2)
    expect(stats.walletTxCount).toBe(2)
    expect(stats.pagesFetched).toBe(1)
  })

  it('should handle all transactions being new', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(prisma.syncState.findUnique as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    const newTransactions = [
      {
        signature: 'brand_new_1',
        slot: 1001,
        blockTime: 1234567891,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['brand_new_1'] },
        version: 0,
      },
      {
        signature: 'brand_new_2',
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['brand_new_2'] },
        version: 0,
      },
    ]

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: newTransactions,
      nextBefore: 'brand_new_2',
    })

    // All signatures are new
    ;(prisma.rawTx.findUnique as any).mockResolvedValue(null)

    mockNormalizer.normalizeTransactions.mockResolvedValue([
      {
        wallet,
        signature: 'brand_new_1',
        index: 0,
        slot: 1001,
        blockTime: 1234567891,
        program: null,
        type: 'UNKNOWN',
        direction: 'N/A',
        tokenMint: null,
        tokenSymbol: null,
        tokenDecimals: null,
        amountRaw: null,
        amountUi: null,
        amountUsd: null,
        priceUsdAtTx: null,
        meta: null,
      },
      {
        wallet,
        signature: 'brand_new_2',
        index: 0,
        slot: 1000,
        blockTime: 1234567890,
        program: null,
        type: 'UNKNOWN',
        direction: 'N/A',
        tokenMint: null,
        tokenSymbol: null,
        tokenDecimals: null,
        amountRaw: null,
        amountUi: null,
        amountUsd: null,
        priceUsdAtTx: null,
        meta: null,
      },
    ])

    ;(prisma.syncState.update as any).mockResolvedValue({})

    const stats = await paginationManager.syncTail(wallet)

    // Should process all transactions
    expect(mockNormalizer.persistRawTransactions).toHaveBeenCalledWith(newTransactions)
    expect(stats.rawTxCount).toBe(2)
    expect(stats.walletTxCount).toBe(2)
  })

  it('should handle no new transactions', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(prisma.syncState.findUnique as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: 'current_cursor',
      verifiedSlot: 1000,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    const existingTransactions = [
      {
        signature: 'existing_1',
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['existing_1'] },
        version: 0,
      },
    ]

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: existingTransactions,
      nextBefore: 'existing_1',
    })

    // First transaction already exists
    ;(prisma.rawTx.findUnique as any).mockResolvedValue({ signature: 'existing_1' })

    const stats = await paginationManager.syncTail(wallet)

    // Should not persist anything
    expect(mockNormalizer.persistRawTransactions).not.toHaveBeenCalled()
    expect(mockNormalizer.persistWalletEvents).not.toHaveBeenCalled()
    
    expect(stats.rawTxCount).toBe(0)
    expect(stats.walletTxCount).toBe(0)
  })

  it('should handle empty response', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(prisma.syncState.findUnique as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: [],
      nextBefore: null,
    })

    const stats = await paginationManager.syncTail(wallet)

    expect(stats.rawTxCount).toBe(0)
    expect(stats.walletTxCount).toBe(0)
    expect(stats.pagesFetched).toBe(0)
  })

  it('should throw error if no sync state exists', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(prisma.syncState.findUnique as any).mockResolvedValue(null)

    await expect(paginationManager.syncTail(wallet))
      .rejects.toThrow(`No sync state found for wallet ${wallet}. Run backfill first.`)
  })

  it('should update verified slot with highest slot from new transactions', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(prisma.syncState.findUnique as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: 1000,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    const newTransactions = [
      {
        signature: 'high_slot_tx',
        slot: 1005, // Highest slot
        blockTime: 1234567895,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['high_slot_tx'] },
        version: 0,
      },
      {
        signature: 'low_slot_tx',
        slot: 1003,
        blockTime: 1234567893,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['low_slot_tx'] },
        version: 0,
      },
    ]

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: newTransactions,
      nextBefore: 'low_slot_tx',
    })

    ;(prisma.rawTx.findUnique as any).mockResolvedValue(null)
    mockNormalizer.normalizeTransactions.mockResolvedValue([])
    ;(prisma.syncState.update as any).mockResolvedValue({})

    const stats = await paginationManager.syncTail(wallet)

    // Should update sync state with highest slot (1005)
    expect(prisma.syncState.update).toHaveBeenCalledWith({
      where: { wallet },
      data: {
        verifiedSlot: 1005,
      },
    })

    expect(stats.verifiedSlot).toBe(1005)
    expect(stats.firstSlot).toBe(1005)
    expect(stats.lastSlot).toBe(1003)
  })
})
