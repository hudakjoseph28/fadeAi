import { PriceService } from './PriceService'
import { DexscreenerPriceService } from './DexscreenerPriceService'
import { BirdeyePriceService } from './BirdeyePriceService'
import { config } from '@/lib/config'

export function createPriceService(): PriceService {
  switch (config.PRICE_PROVIDER) {
    case 'birdeye':
      return new BirdeyePriceService()
    case 'dexscreener':
    default:
      return new DexscreenerPriceService()
  }
}

export type { PriceService, Candle } from './PriceService'
export { DexscreenerPriceService } from './DexscreenerPriceService'
export { BirdeyePriceService } from './BirdeyePriceService'
