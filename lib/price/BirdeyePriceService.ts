import { PriceService, Candle } from './PriceService'
import { prisma } from '@/lib/db/prisma'
import { config } from '@/lib/config'

export class BirdeyePriceService implements PriceService {
  private readonly baseUrl = 'https://public-api.birdeye.so'
  private readonly apiKey = config.BIRDEYE_API_KEY

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

    try {
      // Convert resolution to Birdeye format
      const intervalMap = {
        '1m': '1m',
        '5m': '5m',
        '1h': '1h',
        '1d': '1d',
      }

      const interval = intervalMap[resolution]
      const startTime = Math.floor(start / 1000) // Convert to seconds
      const endTime = Math.floor(end / 1000)

      const response = await fetch(
        `${this.baseUrl}/defi/ohlcv?address=${tokenMint}&type=${interval}&time_from=${startTime}&time_to=${endTime}`,
        {
          headers: {
            'X-API-KEY': this.apiKey || '',
          },
        }
      )

      if (!response.ok) {
        return []
      }

      const data = await response.json()
      
      if (data.data && data.data.items) {
        const candles: Candle[] = data.data.items.map((item: any) => ({
          t: item.unixTime,
          o: parseFloat(item.o),
          h: parseFloat(item.h),
          l: parseFloat(item.l),
          c: parseFloat(item.c),
        }))

        // Cache the candles
        await this.cacheCandles(tokenMint, resolution, candles)

        return candles
      }

      return []
    } catch (error) {
      console.error('Error fetching candles from Birdeye:', error)
      return []
    }
  }

  async getCurrentPriceUsd(tokenMint: string): Promise<number | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/defi/price?address=${tokenMint}`,
        {
          headers: {
            'X-API-KEY': this.apiKey || '',
          },
        }
      )

      if (!response.ok) {
        return null
      }

      const data = await response.json()
      return data.data?.value || null
    } catch (error) {
      console.error('Error fetching price from Birdeye:', error)
      return null
    }
  }

  private async cacheCandles(
    tokenMint: string,
    resolution: string,
    candles: Candle[]
  ): Promise<void> {
    try {
      const candleData = candles.map(candle => ({
        tokenMint,
        t: candle.t,
        o: candle.o,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        resolution,
      }))

      await prisma.candle.createMany({
        data: candleData,
      })
    } catch (error) {
      console.error('Error caching candles:', error)
    }
  }
}
