import Decimal from 'decimal.js'
import { WalletEvent } from '@/lib/indexer/normalize'
import { PriceService } from '@/lib/price'
import { SOL_MINT, SOL_DECIMALS } from '@/lib/indexer/constants'

export interface Lot {
  lotId: string
  tokenMint: string
  buyTime: number
  buyQty: number
  buyCostUsd?: number
  remainingQty: number
  matchedSells: Array<{
    time: number
    qty: number
    proceedsUsd?: number
  }>
  realizedUsd: number
  peakTimestamp: number | null
  peakPriceUsd: number | null
  peakPotentialUsd: number
  regretGapUsd: number
}

export interface TokenPosition {
  tokenMint: string
  symbol: string
  realizedUsd: number
  peakPotentialUsd: number
  regretGapUsd: number
  lots: Lot[]
}

export interface PositionSummary {
  totalRealizedUsd: number
  totalPeakPotentialUsd: number
  totalRegretGapUsd: number
  openPositionsUsd: number
}

export class PositionReconstructor {
  constructor(private priceService: PriceService) {}

  async reconstructPositions(
    activities: WalletEvent[],
    currentPrices: Map<string, number>
  ): Promise<{
    summary: PositionSummary
    tokens: TokenPosition[]
  }> {
    // Group activities by token
    const tokenActivities = new Map<string, WalletEvent[]>()
    
    for (const activity of activities) {
      if (!tokenActivities.has(activity.mint)) {
        tokenActivities.set(activity.mint, [])
      }
      tokenActivities.get(activity.mint)!.push(activity)
    }

    const tokenPositions: TokenPosition[] = []
    let totalRealizedUsd = new Decimal(0)
    let totalPeakPotentialUsd = new Decimal(0)
    let totalRegretGapUsd = new Decimal(0)
    let openPositionsUsd = new Decimal(0)

    // Process each token
    for (const [tokenMint, tokenActs] of tokenActivities) {
      console.log(`Processing token ${tokenMint} with ${tokenActs.length} activities`)
      const lots = await this.processTokenActivities(tokenMint, tokenActs)
      
      // Calculate token-level metrics
      const realizedUsd = lots.reduce((sum, lot) => sum.plus(lot.realizedUsd), new Decimal(0))
      const peakPotentialUsd = lots.reduce((sum, lot) => sum.plus(lot.peakPotentialUsd), new Decimal(0))
      const regretGapUsd = lots.reduce((sum, lot) => sum.plus(lot.regretGapUsd), new Decimal(0))
      
      // Calculate open position value
      const openLots = lots.filter(lot => lot.remainingQty > 0)
      const currentPrice = currentPrices.get(tokenMint) || 0
      const openValue = openLots.reduce((sum, lot) => 
        sum.plus(new Decimal(lot.remainingQty).times(currentPrice)), new Decimal(0)
      )

      // Get token symbol from metadata or use fallback
      const symbol = tokenMint === SOL_MINT ? 'SOL' : 
        (tokenActs[0]?.mint ? tokenActs[0].mint.slice(0,4) + '…' + tokenActs[0].mint.slice(-4) : 'UNKNOWN')

      tokenPositions.push({
        tokenMint,
        symbol,
        realizedUsd: realizedUsd.toNumber(),
        peakPotentialUsd: peakPotentialUsd.toNumber(),
        regretGapUsd: regretGapUsd.toNumber(),
        lots,
      })

      totalRealizedUsd = totalRealizedUsd.plus(realizedUsd)
      totalPeakPotentialUsd = totalPeakPotentialUsd.plus(peakPotentialUsd)
      totalRegretGapUsd = totalRegretGapUsd.plus(regretGapUsd)
      openPositionsUsd = openPositionsUsd.plus(openValue)
    }

    return {
      summary: {
        totalRealizedUsd: totalRealizedUsd.toNumber(),
        totalPeakPotentialUsd: totalPeakPotentialUsd.toNumber(),
        totalRegretGapUsd: totalRegretGapUsd.toNumber(),
        openPositionsUsd: openPositionsUsd.toNumber(),
      },
      tokens: tokenPositions,
    }
  }

  private async processTokenActivities(
    tokenMint: string,
    activities: WalletEvent[]
  ): Promise<Lot[]> {
    console.log(`processTokenActivities: ${tokenMint}, ${activities.length} activities`)
    const lots: Lot[] = []
    const openLots: Lot[] = []

    for (const activity of activities) {
      if (activity.side === 'BUY') {
        // Get price at transaction time using candles
        const candles = await this.priceService.getCandles({
          tokenMint,
          start: activity.ts,
          end: activity.ts + 3600, // 1 hour window
          resolution: '1h'
        })
        const priceAtTx = candles.length > 0 ? candles[0].c : 0
        
        // Create new lot
        const lot: Lot = {
          lotId: `${activity.sig}-${activity.ts}`,
          tokenMint,
          buyTime: activity.ts,
          buyQty: Math.abs(activity.qty), // qty is positive for BUY
          buyCostUsd: priceAtTx,
          remainingQty: Math.abs(activity.qty),
          matchedSells: [],
          realizedUsd: 0,
          peakTimestamp: null,
          peakPriceUsd: null,
          peakPotentialUsd: 0,
          regretGapUsd: 0,
        }
        
        lots.push(lot)
        openLots.push(lot)
      } else if (activity.side === 'SELL') {
        // Match against open lots using FIFO
        let remainingSellQty = Math.abs(activity.qty) // qty is negative for SELL, make positive
        
        while (remainingSellQty > 0 && openLots.length > 0) {
          const lot = openLots[0]
          const matchQty = Math.min(remainingSellQty, lot.remainingQty)
          
          // Get price at sell time using candles
          const sellCandles = await this.priceService.getCandles({
            tokenMint,
            start: activity.ts,
            end: activity.ts + 3600, // 1 hour window
            resolution: '1h'
          })
          const sellPrice = sellCandles.length > 0 ? sellCandles[0].c : 0
          
          // Calculate proceeds with fee deduction if applicable
          let proceedsUsd = matchQty * sellPrice
          if (activity.feeLamports && activity.feeLamports > 0) {
            // Convert fee from lamports to SOL, then to USD
            const feeInSol = activity.feeLamports / Math.pow(10, SOL_DECIMALS)
            const solCandles = await this.priceService.getCandles({
              tokenMint: SOL_MINT,
              start: activity.ts,
              end: activity.ts + 3600, // 1 hour window
              resolution: '1h'
            })
            const solPrice = solCandles.length > 0 ? solCandles[0].c : 0
            const feeInUsd = feeInSol * solPrice
            proceedsUsd -= feeInUsd
          }
          
          // Record the sell match
          lot.matchedSells.push({
            time: activity.ts,
            qty: matchQty,
            proceedsUsd: proceedsUsd,
          })
          
          // Update lot quantities
          lot.remainingQty -= matchQty
          remainingSellQty -= matchQty
          
          // If lot is fully closed, remove from open lots
          if (lot.remainingQty <= 0.000001) { // Handle floating point precision
            openLots.shift()
          }
        }
      }
    }

    // Calculate peak potential and regret gap for each lot
    for (const lot of lots) {
      await this.calculateLotMetrics(lot)
    }

    return lots
  }

  private async calculateLotMetrics(lot: Lot): Promise<void> {
    const endTime = lot.matchedSells.length > 0 
      ? lot.matchedSells[lot.matchedSells.length - 1].time 
      : Math.floor(Date.now() / 1000)

    // Determine resolution based on time window
    const timeWindow = endTime - lot.buyTime
    const resolution = timeWindow <= 60 * 24 * 60 * 60 ? '1h' : '1d' // 60 days

    try {
      // Get price candles for the lot's time window
      const candles = await this.priceService.getCandles({
        tokenMint: lot.tokenMint,
        start: lot.buyTime,
        end: endTime,
        resolution,
      })

      if (candles.length > 0) {
        // Find peak price
        const peakCandle = candles.reduce((max, candle) => 
          candle.h > max.h ? candle : max
        )
        
        lot.peakTimestamp = peakCandle.t
        lot.peakPriceUsd = peakCandle.h
        lot.peakPotentialUsd = new Decimal(lot.buyQty).times(peakCandle.h).toNumber()
      }

      // Calculate realized proceeds
      const realizedProceeds = lot.matchedSells.reduce((sum, sell) => 
        sum.plus(sell.proceedsUsd || 0), new Decimal(0)
      )
      
      lot.realizedUsd = realizedProceeds.toNumber()

      // Calculate regret gap
      if (lot.remainingQty > 0) {
        // Still holding - compare current value to peak potential
        const currentPrice = await this.priceService.getCurrentPriceUsd(lot.tokenMint)
        if (currentPrice) {
          const currentValue = new Decimal(lot.remainingQty).times(currentPrice)
          const totalValue = realizedProceeds.plus(currentValue)
          lot.regretGapUsd = Math.max(0, lot.peakPotentialUsd - totalValue.toNumber())
        } else {
          lot.regretGapUsd = Math.max(0, lot.peakPotentialUsd - lot.realizedUsd)
        }
      } else {
        // Fully sold - compare realized proceeds to peak potential
        lot.regretGapUsd = Math.max(0, lot.peakPotentialUsd - lot.realizedUsd)
      }
    } catch (error) {
      console.error(`Error calculating metrics for lot ${lot.lotId}:`, error)
      // Set default values if price data is unavailable
      lot.peakPotentialUsd = lot.realizedUsd
      lot.regretGapUsd = 0
    }
  }
}
