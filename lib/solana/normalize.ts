import { ParsedTransaction } from './heliusClient'
import { TokenMetadata } from './solscanClient'

export interface WalletActivity {
  signature: string
  blockTime: number
  tokenMint: string
  tokenSymbol: string
  decimals: number
  direction: 'BUY' | 'SELL'
  quantity: number
  nativeUsdAtTx?: number
  priceUsdAtTx?: number
}

export function normalizeTransactions(
  transactions: ParsedTransaction[],
  tokenMetadata: Map<string, TokenMetadata>
): WalletActivity[] {
  const activities: WalletActivity[] = []

  for (const tx of transactions) {
    for (const transfer of tx.tokenTransfers) {
      const metadata = tokenMetadata.get(transfer.mint)
      
      if (!metadata) {
        continue // Skip tokens without metadata
      }

      // Determine if this is a buy or sell based on direction
      const isBuy = transfer.to !== 'unknown' // Simplified logic
      const direction = isBuy ? 'BUY' : 'SELL'

      activities.push({
        signature: tx.signature,
        blockTime: tx.blockTime,
        tokenMint: transfer.mint,
        tokenSymbol: metadata.symbol,
        decimals: metadata.decimals,
        direction,
        quantity: transfer.uiAmount,
        // Price and USD values would be calculated separately
      })
    }
  }

  return activities.sort((a, b) => a.blockTime - b.blockTime)
}
