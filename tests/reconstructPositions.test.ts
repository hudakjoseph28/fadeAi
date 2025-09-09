import { describe, it, expect, vi } from 'vitest'
import { PositionReconstructor } from '@/lib/solana/reconstructPositions'
import { WalletActivity } from '@/lib/solana/normalize'
import { PriceService } from '@/lib/price'

// Mock price service
const mockPriceService: PriceService = {
  getCandles: vi.fn().mockResolvedValue([
    { t: 1000, o: 1, h: 5, l: 0.5, c: 2 },
    { t: 2000, o: 2, h: 10, l: 1, c: 3 },
  ]),
  getCurrentPriceUsd: vi.fn().mockResolvedValue(3),
}

describe('PositionReconstructor', () => {
  it('should reconstruct positions correctly with FIFO matching', async () => {
    const reconstructor = new PositionReconstructor(mockPriceService)
    
    const activities: WalletActivity[] = [
      {
        signature: 'buy1',
        blockTime: 1000,
        tokenMint: 'token1',
        tokenSymbol: 'TOKEN1',
        decimals: 6,
        direction: 'BUY',
        quantity: 100,
      },
      {
        signature: 'sell1',
        blockTime: 2000,
        tokenMint: 'token1',
        tokenSymbol: 'TOKEN1',
        decimals: 6,
        direction: 'SELL',
        quantity: 50,
      },
    ]

    const currentPrices = new Map([['token1', 3]])
    const result = await reconstructor.reconstructPositions(activities, currentPrices)

    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0].lots).toHaveLength(1)
    expect(result.tokens[0].lots[0].remainingQty).toBe(50)
    expect(result.tokens[0].lots[0].matchedSells).toHaveLength(1)
  })

  it('should calculate peak potential correctly', async () => {
    const reconstructor = new PositionReconstructor(mockPriceService)
    
    const activities: WalletActivity[] = [
      {
        signature: 'buy1',
        blockTime: 1000,
        tokenMint: 'token1',
        tokenSymbol: 'TOKEN1',
        decimals: 6,
        direction: 'BUY',
        quantity: 100,
      },
    ]

    const currentPrices = new Map([['token1', 3]])
    const result = await reconstructor.reconstructPositions(activities, currentPrices)

    expect(result.tokens[0].lots[0].peakPriceUsd).toBe(10) // Highest price from mock candles
    expect(result.tokens[0].lots[0].peakPotentialUsd).toBe(1000) // 100 * 10
  })
})
