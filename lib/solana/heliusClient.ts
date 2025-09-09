import { config } from '@/lib/config'

export interface HeliusTransaction {
  signature: string
  blockTime: number
  slot: number
  meta: {
    err: any
    fee: number
    preBalances: number[]
    postBalances: number[]
    innerInstructions?: any[]
    preTokenBalances?: Array<{
      accountIndex: number
      mint: string
      owner: string
      programId: string
      uiTokenAmount: {
        amount: string
        decimals: number
        uiAmount: number
        uiAmountString: string
      }
    }>
    postTokenBalances?: Array<{
      accountIndex: number
      mint: string
      owner: string
      programId: string
      uiTokenAmount: {
        amount: string
        decimals: number
        uiAmount: number
        uiAmountString: string
      }
    }>
  }
  transaction: {
    message: {
      accountKeys: string[]
      instructions: Array<{
        programIdIndex: number
        accounts: number[]
        data: string
      }>
    }
  }
}

export interface ParsedTransaction {
  signature: string
  blockTime: number
  tokenTransfers: Array<{
    mint: string
    from: string
    to: string
    amount: string
    decimals: number
    uiAmount: number
  }>
  swapTransfers?: Array<{
    inputMint: string
    outputMint: string
    inputAmount: string
    outputAmount: string
    inputDecimals: number
    outputDecimals: number
    inputUiAmount: number
    outputUiAmount: number
  }>
}

export class HeliusClient {
  private readonly baseUrl = 'https://api.helius.xyz/v0'
  private readonly apiKey: string

  constructor() {
    this.apiKey = config.HELIUS_API_KEY
  }

  async getParsedTransactions(
    wallet: string,
    before?: string,
    limit = 1000
  ): Promise<ParsedTransaction[]> {
    try {
      const params = new URLSearchParams({
        'api-key': this.apiKey,
        limit: limit.toString(),
      })

      if (before) {
        params.append('before', before)
      }

      const response = await fetch(
        `${this.baseUrl}/addresses/${wallet}/transactions?${params}`
      )

      if (!response.ok) {
        throw new Error(`Helius API error: ${response.status}`)
      }

      const data = await response.json()
      return this.parseTransactions(data, wallet)
    } catch (error) {
      console.error('Error fetching transactions from Helius:', error)
      throw error
    }
  }

  async getAllTransactions(wallet: string): Promise<ParsedTransaction[]> {
    const allTransactions: ParsedTransaction[] = []
    let before: string | undefined

    while (true) {
      const transactions = await this.getParsedTransactions(wallet, before)
      
      if (transactions.length === 0) {
        break
      }

      allTransactions.push(...transactions)
      before = transactions[transactions.length - 1].signature

      // Add a small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return allTransactions
  }

  private parseTransactions(transactions: HeliusTransaction[], wallet: string): ParsedTransaction[] {
    return transactions
      .filter(tx => tx.meta.err === null) // Only successful transactions
      .map(tx => {
        const tokenTransfers: ParsedTransaction['tokenTransfers'] = []
        const swapTransfers: ParsedTransaction['swapTransfers'] = []

        // Parse token balance changes
        const preBalances = tx.meta.preTokenBalances || []
        const postBalances = tx.meta.postTokenBalances || []

        // Find token transfers by comparing pre/post balances
        const balanceMap = new Map<string, { pre: any; post: any }>()

        preBalances.forEach(balance => {
          if (!balanceMap.has(balance.mint)) {
            balanceMap.set(balance.mint, { pre: null, post: null })
          }
          balanceMap.get(balance.mint)!.pre = balance
        })

        postBalances.forEach(balance => {
          if (!balanceMap.has(balance.mint)) {
            balanceMap.set(balance.mint, { pre: null, post: null })
          }
          balanceMap.get(balance.mint)!.post = balance
        })

        // Process balance changes
        balanceMap.forEach(({ pre, post }, mint) => {
          if (pre && post) {
            const preAmount = parseFloat(pre.uiTokenAmount.uiAmountString || '0')
            const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || '0')
            const change = postAmount - preAmount

            if (Math.abs(change) > 0.000001) { // Ignore dust
              // Determine direction based on account ownership
              const walletAccountIndex = tx.transaction.message.accountKeys.findIndex(
                key => key === wallet
              )

              if (change > 0) {
                // Token received
                tokenTransfers.push({
                  mint,
                  from: 'unknown', // Would need more complex parsing to determine
                  to: wallet,
                  amount: Math.abs(change).toString(),
                  decimals: post.uiTokenAmount.decimals,
                  uiAmount: Math.abs(change),
                })
              } else {
                // Token sent
                tokenTransfers.push({
                  mint,
                  from: wallet,
                  to: 'unknown',
                  amount: Math.abs(change).toString(),
                  decimals: pre.uiTokenAmount.decimals,
                  uiAmount: Math.abs(change),
                })
              }
            }
          }
        })

        return {
          signature: tx.signature,
          blockTime: tx.blockTime,
          tokenTransfers,
          swapTransfers,
        }
      })
  }
}
