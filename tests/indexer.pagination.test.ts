import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe('PaginationManager', () => {
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should handle empty response from Helius', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: [],
      nextBefore: undefined,
    })

    ;(prisma.syncState.findUnique as any).mockResolvedValue(null)
    ;(prisma.syncState.create as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    ;(prisma.syncState.update as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    const stats = await paginationManager.backfillWallet(wallet, 1)

    expect(stats.pagesFetched).toBe(0)
    expect(stats.rawTxCount).toBe(0)
    expect(stats.walletTxCount).toBe(0)
    expect(mockHeliusClient.getParsedTransactions).toHaveBeenCalledTimes(1)
  })

  it('should handle single page response', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const mockTransactions = [
      {
        signature: 'sig1',
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig1'] },
      },
      {
        signature: 'sig2',
        slot: 1001,
        blockTime: 1234567891,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig2'] },
      },
    ]

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: mockTransactions,
      nextBefore: undefined,
    })

    mockNormalizer.normalizeTransactions.mockResolvedValue([
      {
        wallet,
        signature: 'sig1',
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

    ;(prisma.syncState.findUnique as any).mockResolvedValue(null)
    ;(prisma.syncState.create as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    ;(prisma.syncState.update as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: undefined,
      verifiedSlot: 1000,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    const stats = await paginationManager.backfillWallet(wallet, 1)

    expect(stats.pagesFetched).toBe(1)
    expect(stats.rawTxCount).toBe(2)
    expect(stats.walletTxCount).toBe(1)
    expect(mockNormalizer.persistRawTransactions).toHaveBeenCalledWith(mockTransactions)
    expect(mockNormalizer.persistWalletEvents).toHaveBeenCalledTimes(1)
  })

  it('should handle multiple pages with pagination', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    // First page
    const page1Transactions = [
      {
        signature: 'sig1',
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig1'] },
      },
    ]

    // Second page
    const page2Transactions = [
      {
        signature: 'sig2',
        slot: 999,
        blockTime: 1234567889,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig2'] },
      },
    ]

    mockHeliusClient.getParsedTransactions
      .mockResolvedValueOnce({
        items: page1Transactions,
        nextBefore: 'sig1',
      })
      .mockResolvedValueOnce({
        items: [], // Empty items to stop pagination
        nextBefore: null,
      })

    mockNormalizer.normalizeTransactions.mockResolvedValue([])

    ;(prisma.syncState.findUnique as any).mockResolvedValue(null)
    ;(prisma.syncState.create as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    ;(prisma.syncState.update as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: 'sig1',
      verifiedSlot: 999,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    const stats = await paginationManager.backfillWallet(wallet, 2)

    expect(stats.pagesFetched).toBe(2)
    expect(stats.rawTxCount).toBe(2)
    expect(mockHeliusClient.getParsedTransactions).toHaveBeenCalledTimes(2)
    expect(mockHeliusClient.getParsedTransactions).toHaveBeenNthCalledWith(1, wallet, undefined, 1000)
    expect(mockHeliusClient.getParsedTransactions).toHaveBeenNthCalledWith(2, wallet, 'sig1', 1000)
  })

  it('should be idempotent when run twice', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const mockTransactions = [
      {
        signature: 'sig1',
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig1'] },
      },
    ]

    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: mockTransactions,
      nextBefore: undefined,
    })

    mockNormalizer.normalizeTransactions.mockResolvedValue([])

    ;(prisma.syncState.findUnique as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: null,
      verifiedSlot: null,
      fullScanAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    ;(prisma.syncState.update as any).mockResolvedValue({
      id: `wallet:${wallet}`,
      wallet,
      lastBefore: undefined,
      verifiedSlot: 1000,
      fullScanAt: new Date(),
      updatedAt: new Date(),
      createdAt: new Date(),
    })

    // Run twice
    const stats1 = await paginationManager.backfillWallet(wallet, 1)
    const stats2 = await paginationManager.backfillWallet(wallet, 1)

    expect(stats1.rawTxCount).toBe(1)
    expect(stats2.rawTxCount).toBe(1)
    expect(mockNormalizer.persistRawTransactions).toHaveBeenCalledTimes(2)
    expect(mockNormalizer.persistWalletEvents).toHaveBeenCalledTimes(2)
  })
})
