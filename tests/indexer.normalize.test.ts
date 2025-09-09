import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransactionNormalizer } from '@/lib/indexer/normalize'
import { HeliusTransaction, WalletEvent } from '@/lib/indexer/types'
import { SolscanClient } from '@/lib/indexer/solscanClient'
import { prisma } from '@/lib/db/prisma'

// Mock the dependencies
vi.mock('@/lib/indexer/solscanClient', () => ({
  SolscanClient: vi.fn().mockImplementation(() => ({
    getMultipleTokenMetadata: vi.fn().mockResolvedValue(Object.fromEntries([
      ['So11111111111111111111111111111111111111112', { symbol: "WSOL", decimals: 9 }],
      ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: "USDC", decimals: 6 }]
    ]))
  }))
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tokenMeta: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    walletTx: {
      upsert: vi.fn(),
    },
  },
}))

describe('TransactionNormalizer', () => {
  let normalizer: TransactionNormalizer
  let mockSolscanClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Reset the mock implementation
    vi.mocked(SolscanClient).mockImplementation(() => ({
      getMultipleTokenMetadata: vi.fn().mockResolvedValue(Object.fromEntries([
        ['So11111111111111111111111111111111111111112', { symbol: "WSOL", decimals: 9 }],
        ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: "USDC", decimals: 6 }]
      ]))
    }))
    
    normalizer = new TransactionNormalizer()
  })

  const createMockTransaction = (signature: string, wallet: string): HeliusTransaction => ({
    signature,
    slot: 1000,
    blockTime: 1234567890,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1000000000, 0], // 1 SOL, 0
      postBalances: [500000000, 500000000], // 0.5 SOL, 0.5 SOL
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      logMessages: [],
    },
    transaction: {
      message: {
        accountKeys: [wallet, '11111111111111111111111111111111'], // wallet, system program
        instructions: [{
          programIdIndex: 1,
          accounts: [0, 1],
          data: 'base64data',
        }],
        addressTableLookups: [],
      },
      signatures: [signature],
    },
    version: 0,
  })

  it('should normalize SOL transfer transaction', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const transaction = createMockTransaction('sol_transfer_sig', wallet)
    
    // Mock database calls
    ;(prisma.tokenMeta.findMany as any).mockResolvedValue([])
    ;(prisma.tokenMeta.createMany as any).mockResolvedValue({ count: 0 })

    const events = await normalizer.normalizeTransactions([transaction], wallet)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      wallet,
      signature: 'sol_transfer_sig',
      index: 0,
      slot: 1000,
      blockTime: 1234567890,
      program: '11111111111111111111111111111111',
      type: 'TRANSFER',
      direction: 'OUT',
      tokenMint: 'So11111111111111111111111111111111111111112', // WSOL mint
      tokenSymbol: 'SOL',
      tokenDecimals: 9,
      amountRaw: '0.5',
      amountUi: 0.5,
    })
  })

  it('should normalize SPL token transfer transaction', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const tokenMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC
    const otherWallet = '11111111111111111111111111111111'
    
    const transaction: HeliusTransaction = {
      signature: 'spl_transfer_sig',
      slot: 1000,
      blockTime: 1234567890,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 0],
        postBalances: [995000000, 0],
        preTokenBalances: [{
          accountIndex: 0,
          mint: tokenMint,
          owner: wallet,
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '1000000',
            decimals: 6,
            uiAmount: 1.0,
            uiAmountString: '1.0',
          },
        }],
        postTokenBalances: [{
          accountIndex: 0,
          mint: tokenMint,
          owner: wallet,
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '500000',
            decimals: 6,
            uiAmount: 0.5,
            uiAmountString: '0.5',
          },
        }],
        innerInstructions: [],
        logMessages: [],
      },
      transaction: {
        message: {
          accountKeys: [wallet, otherWallet, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
          instructions: [{
            programIdIndex: 2,
            accounts: [0, 1],
            data: 'base64data',
          }],
          addressTableLookups: [],
        },
        signatures: ['spl_transfer_sig'],
      },
      version: 0,
    }

    // Mock database calls
    vi.mocked(prisma.tokenMeta.findMany).mockResolvedValue([{
      tokenMint,
      symbol: 'USDC',
      decimals: 6,
      updatedAt: new Date(),
    }])
    vi.mocked(prisma.tokenMeta.createMany).mockResolvedValue({ count: 0 })

    const events = await normalizer.normalizeTransactions([transaction], wallet)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      wallet,
      signature: 'spl_transfer_sig',
      index: 0,
      slot: 1000,
      blockTime: 1234567890,
      program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      type: 'TRANSFER',
      direction: 'OUT',
      tokenMint,
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      amountRaw: '0.5',
      amountUi: 0.5,
    })
  })

  it('should handle DEX swap transaction', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const tokenMintA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC
    const tokenMintB = 'So11111111111111111111111111111111111111112' // SOL
    
    const transaction: HeliusTransaction = {
      signature: 'dex_swap_sig',
      slot: 1000,
      blockTime: 1234567890,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 0],
        postBalances: [995000000, 0],
        preTokenBalances: [{
          accountIndex: 0,
          mint: tokenMintA,
          owner: wallet,
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '1000000',
            decimals: 6,
            uiAmount: 1.0,
            uiAmountString: '1.0',
          },
        }],
        postTokenBalances: [{
          accountIndex: 0,
          mint: tokenMintA,
          owner: wallet,
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '0',
            decimals: 6,
            uiAmount: 0,
            uiAmountString: '0',
          },
        }],
        innerInstructions: [{
          index: 0,
          instructions: [{
            programIdIndex: 1,
            accounts: [0, 1],
            data: 'swapdata',
          }],
        }],
        logMessages: ['Program log: Swap executed'],
      },
      transaction: {
        message: {
          accountKeys: [wallet, '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'], // wallet, raydium, token
          instructions: [{
            programIdIndex: 1,
            accounts: [0, 1],
            data: 'swapdata',
          }],
          addressTableLookups: [],
        },
        signatures: ['dex_swap_sig'],
      },
      version: 0,
    }

    // Mock database calls
    vi.mocked(prisma.tokenMeta.findMany).mockResolvedValue([{
      tokenMint: tokenMintA,
      symbol: 'USDC',
      decimals: 6,
      updatedAt: new Date(),
    }])
    vi.mocked(prisma.tokenMeta.createMany).mockResolvedValue({ count: 0 })

    const events = await normalizer.normalizeTransactions([transaction], wallet)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      wallet,
      signature: 'dex_swap_sig',
      index: 0,
      slot: 1000,
      blockTime: 1234567890,
      program: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium
      type: 'SELL',
      direction: 'OUT',
      tokenMint: tokenMintA,
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
      amountRaw: '1',
      amountUi: 1.0,
    })
  })

  it('should handle WSOL wrap/unwrap transaction', async () => {
    const wallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    const transaction: HeliusTransaction = {
      signature: 'wrapped_sol_sig',
      slot: 1000,
      blockTime: 1234567890,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [1000000000, 0],
        postBalances: [500000000, 0],
        preTokenBalances: [],
        postTokenBalances: [{
          accountIndex: 0,
          mint: 'So11111111111111111111111111111111111111112',
          owner: wallet,
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          uiTokenAmount: {
            amount: '500000000',
            decimals: 9,
            uiAmount: 0.5,
            uiAmountString: '0.5',
          },
        }],
        innerInstructions: [],
        logMessages: ['Program log: WSOL created'],
      },
      transaction: {
        message: {
          accountKeys: [wallet, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
          instructions: [{
            programIdIndex: 1,
            accounts: [0],
            data: 'wrapdata',
          }],
          addressTableLookups: [],
        },
        signatures: ['wrapped_sol_sig'],
      },
      version: 0,
    }

    // Mock database calls
    ;(prisma.tokenMeta.findMany as any).mockResolvedValue([])
    ;(prisma.tokenMeta.createMany as any).mockResolvedValue({ count: 0 })

    const events = await normalizer.normalizeTransactions([transaction], wallet)

    expect(events).toHaveLength(2) // SOL decrease + WSOL increase
    
    const solEvent = events.find(e => e.direction === 'OUT')
    const wsolEvent = events.find(e => e.direction === 'IN')
    
    expect(solEvent).toMatchObject({
      type: 'TRANSFER',
      direction: 'OUT',
      tokenSymbol: 'SOL',
      amountUi: 0.5,
    })
    
    expect(wsolEvent).toMatchObject({
      type: 'WRAP',
      direction: 'IN',
      tokenSymbol: 'SOL',
      amountUi: 0.5,
    })
  })

  it('should persist wallet events correctly', async () => {
    const events: WalletEvent[] = [{
      wallet: 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL',
      signature: 'test_sig',
      index: 0,
      slot: 1000,
      blockTime: 1234567890,
      program: '11111111111111111111111111111111',
      type: 'TRANSFER',
      direction: 'OUT',
      tokenMint: 'So11111111111111111111111111111111111111112',
      tokenSymbol: 'SOL',
      tokenDecimals: 9,
      amountRaw: '0.5',
      amountUi: 0.5,
      amountUsd: null,
      priceUsdAtTx: null,
      meta: { test: 'data' },
    }]

    ;(prisma.walletTx.upsert as any).mockResolvedValue({
      id: 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL_test_sig_0',
      wallet: 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL',
      signature: 'test_sig',
      index: 0,
      slot: 1000,
      blockTime: 1234567890,
      program: '11111111111111111111111111111111',
      type: 'TRANSFER',
      direction: 'OUT',
      tokenMint: 'So11111111111111111111111111111111111111112',
      tokenSymbol: 'SOL',
      tokenDecimals: 9,
      amountRaw: '0.5',
      amountUi: 0.5,
      amountUsd: null,
      priceUsdAtTx: null,
      meta: '{"test":"data"}',
      ingestedAt: new Date(),
    })

    await normalizer.persistWalletEvents(events)

    expect(prisma.walletTx.upsert).toHaveBeenCalledWith({
      where: { id: 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL_test_sig_0' },
      update: expect.any(Object),
      create: expect.any(Object),
    })
  })
})
