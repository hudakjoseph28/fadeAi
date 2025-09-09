import { config } from '@/lib/config'
import pRetry from 'p-retry'
import PQueue from 'p-queue'

// Simple fetch function that treats 404s as normal
export async function fetchSolscanJson(url: string, opts?: RequestInit) {
  const max = 3;
  for (let i = 0; i < max; i++) {
    const r = await fetch(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } });
    if (r.status === 404) return null; // <-- treat as missing; no throw
    if (r.ok) return await r.json();

    // retry on 429/5xx
    if (r.status === 429 || r.status >= 500) {
      await new Promise(res => setTimeout(res, 250 * (i + 1)));
      continue;
    }
    // other client errors: give up quietly
    return null;
  }
  return null;
}

export interface TokenMetadata {
  mint: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export class SolscanClient {
  private readonly baseUrl = 'https://public-api.solscan.io'
  private readonly apiToken: string
  private readonly queue: PQueue

  constructor() {
    this.apiToken = config.SOLSCAN_API_TOKEN
    this.queue = new PQueue({ 
      concurrency: 2,
      interval: 1000,
      intervalCap: 2
    })
  }

  async getTokenMetadata(tokenMint: string): Promise<TokenMetadata | null> {
    return this.queue.add(async () =>
      pRetry(
        async (): Promise<TokenMetadata | null> => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

          try {
            const response = await fetch(
              `${this.baseUrl}/token/meta?tokenAddress=${tokenMint}`,
              {
                signal: controller.signal,
                headers: {
                  'token': this.apiToken,
                  'Accept': 'application/json',
                },
              }
            )

            clearTimeout(timeoutId)

            if (!response.ok) {
              if (response.status === 404) {
                // 404 is normal for SOL/pump tokens - return null, don't retry
                return null
              }
              if (response.status === 429) {
                throw new Error(`Rate limited: ${response.status}`)
              }
              if (response.status >= 500) {
                throw new Error(`Server error: ${response.status}`)
              }
              // Other client errors - return null, don't retry
              return null
            }

            const data = await response.json()
            
            if (data.success && data.data) {
              return {
                mint: tokenMint,
                symbol: data.data.symbol || 'UNKNOWN',
                name: data.data.name || 'Unknown Token',
                decimals: data.data.decimals || 0,
                logoURI: data.data.logoURI,
              }
            }

            return null
          } catch (error) {
            clearTimeout(timeoutId)
            throw error
          }
        },
        {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
          randomize: true,
          onFailedAttempt: (error: any) => {
            console.warn(`Solscan API attempt ${error.attemptNumber} failed for ${tokenMint}:`, error?.message || String(error))
          },
        }
      )
    ) as Promise<TokenMetadata | null>
  }

  async getMultipleTokenMetadata(tokenMints: string[]): Promise<Map<string, TokenMetadata>> {
    const metadataMap = new Map<string, TokenMetadata>()
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 10
    for (let i = 0; i < tokenMints.length; i += batchSize) {
      const batch = tokenMints.slice(i, i + batchSize)
      
      const promises = batch.map(async (mint) => {
        try {
          const metadata = await this.getTokenMetadata(mint)
          if (metadata) {
            metadataMap.set(mint, metadata)
          }
        } catch (error) {
          console.warn(`Failed to fetch metadata for ${mint}:`, error)
        }
        return null
      })

      await Promise.all(promises)
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < tokenMints.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    return metadataMap
  }
}
