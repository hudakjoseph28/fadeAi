export interface Candle {
  t: number // timestamp (epoch seconds)
  o: number // open
  h: number // high
  l: number // low
  c: number // close
}

export interface PriceService {
  getCandles(params: {
    tokenMint: string
    start: number
    end: number
    resolution: '1m' | '5m' | '1h' | '1d'
  }): Promise<Candle[]>
  
  getCurrentPriceUsd(tokenMint: string): Promise<number | null>
}
