import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReconciliationManager } from '@/lib/indexer/reconcile'
import { HeliusClient } from '@/lib/indexer/heliusClient'
import { TransactionNormalizer } from '@/lib/indexer/normalize'
import { prisma } from '@/lib/db/prisma'

// Mock the dependencies
vi.mock('@/lib/indexer/heliusClient')
vi.mock('@/lib/indexer/normalize')
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rawTx: {
      findMany: vi.fn(),
    },
    walletTx: {
      findMany: vi.fn(),
    },
    reconcileAudit: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

describe('ReconciliationManager', () => {
  let reconciliationManager: ReconciliationManager
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

    reconciliationManager = new ReconciliationManager()
  })

  it('should pass reconciliation when signatures match', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const fromSlot = 1000
    const toSlot = 1002

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

    // Mock Helius response
    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: mockTransactions,
      nextBefore: undefined,
    })

    // Mock database responses
    ;(prisma.rawTx.findMany as any).mockResolvedValue([
      { signature: 'sig1' },
      { signature: 'sig2' },
    ])

    ;(prisma.walletTx.findMany as any).mockResolvedValue([
      { id: '1', wallet, signature: 'sig1', slot: 1000 },
      { id: '2', wallet, signature: 'sig2', slot: 1001 },
    ])

    ;(prisma.reconcileAudit.create as any).mockResolvedValue({
      id: 'audit1',
      wallet,
      fromSlot,
      toSlot,
      countRaw: 2,
      countWalletTx: 2,
      hash: 'testhash',
      ok: true,
      createdAt: new Date(),
    })

    const result = await reconciliationManager.reconcileSlotRange(wallet, fromSlot, toSlot)

    expect(result.ok).toBe(true)
    expect(result.missingSignatures).toHaveLength(0)
    expect(result.countRaw).toBe(2)
    expect(result.countWalletTx).toBe(2)
  })

  it('should detect and fix missing signatures', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const fromSlot = 1000
    const toSlot = 1002

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
      {
        signature: 'sig3',
        slot: 1002,
        blockTime: 1234567892,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig3'] },
      },
    ]

    // Mock Helius response
    mockHeliusClient.getParsedTransactions.mockResolvedValue({
      items: mockTransactions,
      nextBefore: undefined,
    })

    // Mock database responses - missing sig3
    ;(prisma.rawTx.findMany as any)
      .mockResolvedValueOnce([ // First call for initial check
        { signature: 'sig1' },
        { signature: 'sig2' },
      ])
      .mockResolvedValueOnce([ // Second call after ingesting missing
        { signature: 'sig1' },
        { signature: 'sig2' },
        { signature: 'sig3' },
      ])

    ;(prisma.walletTx.findMany as any).mockResolvedValue([
      { id: '1', wallet, signature: 'sig1', slot: 1000 },
      { id: '2', wallet, signature: 'sig2', slot: 1001 },
    ])

    ;(prisma.reconcileAudit.create as any).mockResolvedValue({
      id: 'audit1',
      wallet,
      fromSlot,
      toSlot,
      countRaw: 3,
      countWalletTx: 2,
      hash: 'testhash',
      ok: true,
      createdAt: new Date(),
    })

    mockNormalizer.normalizeTransactions.mockResolvedValue([])

    const result = await reconciliationManager.reconcileSlotRange(wallet, fromSlot, toSlot)

    expect(result.ok).toBe(true)
    expect(result.missingSignatures).toHaveLength(1)
    expect(result.missingSignatures).toContain('sig3')
    expect(mockNormalizer.persistRawTransactions).toHaveBeenCalledWith([mockTransactions[2]])
  })

  it('should handle reconciliation with multiple pages from Helius', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const fromSlot = 1000
    const toSlot = 1002

    const page1Transactions = [
      {
        signature: 'sig1',
        slot: 1000,
        blockTime: 1234567890,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig1'] },
      },
    ]

    const page2Transactions = [
      {
        signature: 'sig2',
        slot: 999, // Outside range, should be filtered
        blockTime: 1234567889,
        meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
        transaction: { message: { accountKeys: [wallet], instructions: [] }, signatures: ['sig2'] },
      },
    ]

    // Mock Helius responses
    mockHeliusClient.getParsedTransactions
      .mockResolvedValueOnce({
        items: page1Transactions,
        nextBefore: 'sig1',
      })
      .mockResolvedValueOnce({
        items: page2Transactions,
        nextBefore: undefined,
      })

    // Mock database responses
    ;(prisma.rawTx.findMany as any).mockResolvedValue([
      { signature: 'sig1' },
    ])

    ;(prisma.walletTx.findMany as any).mockResolvedValue([
      { id: '1', wallet, signature: 'sig1', slot: 1000 },
    ])

    ;(prisma.reconcileAudit.create as any).mockResolvedValue({
      id: 'audit1',
      wallet,
      fromSlot,
      toSlot,
      countRaw: 1,
      countWalletTx: 1,
      hash: 'testhash',
      ok: true,
      createdAt: new Date(),
    })

    const result = await reconciliationManager.reconcileSlotRange(wallet, fromSlot, toSlot)

    expect(result.ok).toBe(true)
    expect(result.countRaw).toBe(1)
    expect(mockHeliusClient.getParsedTransactions).toHaveBeenCalledTimes(2)
  })

  it('should record audit with correct data', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const fromSlot = 1000
    const toSlot = 1002

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

    ;(prisma.rawTx.findMany as any).mockResolvedValue([
      { signature: 'sig1' },
    ])

    ;(prisma.walletTx.findMany as any).mockResolvedValue([
      { id: '1', wallet, signature: 'sig1', slot: 1000 },
    ])

    ;(prisma.reconcileAudit.create as any).mockResolvedValue({
      id: 'audit1',
      wallet,
      fromSlot,
      toSlot,
      countRaw: 1,
      countWalletTx: 1,
      hash: 'testhash',
      ok: true,
      createdAt: new Date(),
    })

    await reconciliationManager.reconcileSlotRange(wallet, fromSlot, toSlot)

    expect(prisma.reconcileAudit.create).toHaveBeenCalledWith({
      data: {
        id: expect.stringMatching(/^BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL_1000_1002_\d+$/),
        wallet,
        fromSlot,
        toSlot,
        countRaw: 1,
        countWalletTx: 1,
        hash: expect.any(String),
        ok: true,
      },
    })
  })

  it('should get reconciliation history', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const mockHistory = [
      {
        id: 'audit1',
        wallet,
        fromSlot: 1000,
        toSlot: 1002,
        countRaw: 2,
        countWalletTx: 2,
        hash: 'hash1',
        ok: true,
        createdAt: new Date(),
      },
      {
        id: 'audit2',
        wallet,
        fromSlot: 1003,
        toSlot: 1005,
        countRaw: 1,
        countWalletTx: 1,
        hash: 'hash2',
        ok: false,
        createdAt: new Date(),
      },
    ]

    ;(prisma.reconcileAudit.findMany as any).mockResolvedValue(mockHistory)

    const history = await reconciliationManager.getReconciliationHistory(wallet, 10)

    expect(history).toEqual(mockHistory)
    expect(prisma.reconcileAudit.findMany).toHaveBeenCalledWith({
      where: { wallet },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
  })
})
