import { describe, it, expect, vi } from 'vitest'
import { GET } from '@/app/api/analyze/route'
import { NextRequest } from 'next/server'

// Mock the dependencies
vi.mock('@/lib/indexer/heliusClient', () => ({
  HeliusClient: vi.fn().mockImplementation(() => ({
    getAllTransactions: vi.fn().mockResolvedValue([]),
  })),
}))

vi.mock('@/lib/indexer/solscanClient', () => ({
  SolscanClient: vi.fn().mockImplementation(() => ({
    getMultipleTokenMetadata: vi.fn().mockResolvedValue(new Map()),
  })),
}))

vi.mock('@/lib/indexer/normalize', () => ({
  normalizeTransactions: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/price', () => ({
  createPriceService: vi.fn().mockReturnValue({
    getCurrentPriceUsd: vi.fn().mockResolvedValue(1),
  }),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tokenMeta: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

describe('/api/analyze', () => {
  it('should return 400 for missing wallet parameter', async () => {
    const request = new NextRequest('http://localhost:3000/api/analyze')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.code).toBe('MISSING_WALLET')
  })

  it('should return 400 for invalid wallet address', async () => {
    const request = new NextRequest('http://localhost:3000/api/analyze?wallet=invalid')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.code).toBe('INVALID_WALLET')
  })

  it('should return analysis for valid wallet', async () => {
    const validWallet = '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqkDxV'
    const request = new NextRequest(`http://localhost:3000/api/analyze?wallet=${validWallet}`)
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.wallet).toBe(validWallet)
    expect(data.summary).toBeDefined()
    expect(data.tokens).toBeDefined()
  })
})
