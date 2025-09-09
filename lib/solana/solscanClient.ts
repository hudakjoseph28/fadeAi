import { config } from '@/lib/config'

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

  constructor() {
    this.apiToken = config.SOLSCAN_API_TOKEN
  }

  async getTokenMetadata(tokenMint: string): Promise<TokenMetadata | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/token/meta?tokenAddress=${tokenMint}`,
        {
          headers: {
            'token': this.apiToken,
          },
        }
      )

      if (!response.ok) {
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
      console.error('Error fetching token metadata from Solscan:', error)
      return null
    }
  }

  async getMultipleTokenMetadata(tokenMints: string[]): Promise<Map<string, TokenMetadata>> {
    const metadataMap = new Map<string, TokenMetadata>()
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 10
    for (let i = 0; i < tokenMints.length; i += batchSize) {
      const batch = tokenMints.slice(i, i + batchSize)
      
      const promises = batch.map(async (mint) => {
        const metadata = await this.getTokenMetadata(mint)
        if (metadata) {
          metadataMap.set(mint, metadata)
        }
        return metadata
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
