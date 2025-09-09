import { PriceService, Candle } from './PriceService'
import { prisma } from '@/lib/db/prisma'

export class DexscreenerPriceService implements PriceService {
  private readonly baseUrl = 'https://api.dexscreener.com/latest'

  async getCandles(params: {
    tokenMint: string
    start: number
    end: number
    resolution: '1m' | '5m' | '1h' | '1d'
  }): Promise<Candle[]> {
    const { tokenMint, start, end, resolution } = params

    // Check cache first
    const cached = await prisma.candle.findMany({
      where: {
        tokenMint,
        resolution,
        t: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { t: 'asc' },
    })

    if (cached.length > 0) {
      return cached.map(c => ({
        t: c.t,
        o: c.o,
        h: c.h,
        l: c.l,
        c: c.c,
      }))
    }

    // Fetch from Dexscreener (note: Dexscreener doesn't have historical candles API)
    // For now, we'll return empty array and rely on current price
    // In a real implementation, you'd need to use a different service or cache data over time
    return []
  }

  async getCurrentPriceUsd(tokenMint: string): Promise<number | null> {
    try {
      const response = await fetch(`${this.baseUrl}/dex/tokens/${tokenMint}`)
      
      if (!response.ok) {
        return null
      }

      const data = await response.json()
      
      if (data.pairs && data.pairs.length > 0) {
        // Find the pair with the highest liquidity
        const bestPair = data.pairs.reduce((best: any, current: any) => {
          const bestLiquidity = parseFloat(best.liquidity?.usd || '0')
          const currentLiquidity = parseFloat(current.liquidity?.usd || '0')
          return currentLiquidity > bestLiquidity ? current : best
        })

        return parseFloat(bestPair.priceUsd || '0') || null
      }

      return null
    } catch (error) {
      console.error('Error fetching price from Dexscreener:', error)
      return null
    }
  }
}
