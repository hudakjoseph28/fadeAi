import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HeliusClient } from '@/lib/indexer/heliusClient'

// Mock fetch
global.fetch = vi.fn()

describe('HeliusClient', () => {
  let client: HeliusClient
  const mockApiKey = 'test-helius-key'

  beforeEach(() => {
    vi.clearAllMocks()
    // Set environment variable for tests
    process.env.HELIUS_API_KEY = mockApiKey
    process.env.INDEXER_TIMEOUT_MS = '5000'
    process.env.INDEXER_PAGE_LIMIT = '1000'
    
    client = new HeliusClient()
  })

  afterEach(() => {
    delete process.env.HELIUS_API_KEY
    delete process.env.INDEXER_TIMEOUT_MS
    delete process.env.INDEXER_PAGE_LIMIT
  })

  it('should construct with API key from environment', () => {
    expect(client).toBeDefined()
  })

  it('should throw error if API key missing', () => {
    delete process.env.HELIUS_API_KEY
    expect(() => new HeliusClient()).toThrow('HELIUS_API_KEY environment variable is required')
  })

  it('should make correct request without before parameter', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const mockResponse = [
      {
        signature: 'sig1',
        slot: 1000,
        blockTime: 1234567890,
        meta: {
          err: null,
          fee: 5000,
          preBalances: [1000000000],
          postBalances: [995000000],
        },
        transaction: {
          message: {
            accountKeys: [mockWallet],
            instructions: [],
          },
          signatures: ['sig1'],
        },
        version: 0,
      },
    ]

    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    })

    const result = await client.getParsedTransactions(mockWallet)

    expect(fetch).toHaveBeenCalledWith(
      `https://api.helius.xyz/v0/addresses/transactions?api-key=${mockApiKey}`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          addresses: [mockWallet],
          maxSupportedTransactionVersion: 0,
          limit: 1000
        })
      })
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0].signature).toBe('sig1')
    expect(result.nextBefore).toBe('sig1')
  })

  it('should include before parameter when provided', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const beforeSig = 'before_sig_123'
    
    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    })

    await client.getParsedTransactions(mockWallet, beforeSig, 500)

    expect(fetch).toHaveBeenCalledWith(
      `https://api.helius.xyz/v0/addresses/transactions?api-key=${mockApiKey}`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          addresses: [mockWallet],
          maxSupportedTransactionVersion: 0,
          limit: 500,
          before: beforeSig
        })
      })
    )
  })

  it('should handle empty response', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    })

    const result = await client.getParsedTransactions(mockWallet)

    expect(result.items).toHaveLength(0)
    expect(result.nextBefore).toBeNull()
  })

  it('should decode 400 error with hint', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const errorBody = JSON.stringify({
      message: 'Invalid before signature',
      code: 'INVALID_BEFORE',
    })
    
    ;(fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => errorBody,
    })

    await expect(client.getParsedTransactions(mockWallet, 'bad_signature'))
      .rejects.toThrow('Invalid before signature')
  })

  it('should decode API key error with hint', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    const errorBody = JSON.stringify({
      message: 'Unauthorized - invalid api-key',
    })
    
    ;(fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => errorBody,
    })

    await expect(client.getParsedTransactions(mockWallet))
      .rejects.toThrow('Unauthorized - invalid api-key')
  })

  it('should retry 429 and 5xx errors', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    // First call returns 429, second succeeds
    ;(fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      })

    const result = await client.getParsedTransactions(mockWallet)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.items).toHaveLength(0)
  })

  it('should not retry 4xx errors', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found',
    })

    await expect(client.getParsedTransactions(mockWallet))
      .rejects.toThrow()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('should validate response structure', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    // Invalid response structure
    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ invalid: 'structure' }],
    })

    await expect(client.getParsedTransactions(mockWallet))
      .rejects.toThrow()
  })

  it('should respect page limit', async () => {
    const mockWallet = 'BZ1CMB68co2jkKshP9hia65e8nBtAj6bb1tQPggNcXtL'
    
    ;(fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    })

    await client.getParsedTransactions(mockWallet, undefined, 2000)

    // Should be capped at 1000 (INDEXER_PAGE_LIMIT)
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=1000'),
      expect.any(Object)
    )
  })
})
