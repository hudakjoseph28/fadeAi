import { NextRequest, NextResponse } from 'next/server'
import { HeliusClient } from '@/lib/indexer/heliusClient'
import { SolscanClient } from '@/lib/indexer/solscanClient'
import { TransactionNormalizer } from '@/lib/indexer/normalize'
import { PositionReconstructor } from '@/lib/solana/reconstructPositions'
import { createPriceService } from '@/lib/price'
import { prisma } from '@/lib/db/prisma'
import { WalletAddressSchema } from '@/lib/validation/wallet'
import { ApiHttpError } from '@/lib/indexer/errors'
import { getBatchTokenMeta, inferDecimalsFromTransfer } from '@/lib/metadata/tokenMetadata'
import { analyzeOnce } from '@/lib/cache/analyzeCache'
import { HeliusTransaction } from '@/lib/indexer/heliusClient'
import { SOL_MINT } from '@/lib/indexer/constants'

/**
 * Simple P&L estimation algorithm:
 * - For each transaction with token transfers, fetch historical USD price at transaction time
 * - Compute amount * price_at_time for incoming/outgoing tokens
 * - Estimate net USD change per transaction and sum across all transactions
 */
async function estimateSimplePAndL(
  transactions: HeliusTransaction[],
  wallet: string,
  priceService: ReturnType<typeof createPriceService>,
  currentPrices: Map<string, number>, // Pre-fetched prices to avoid API calls
  userWallets: Set<string>,
  knownExchanges: Set<string>,
  includeInternal: boolean,
  verboseLogging: boolean = false,
  debugPrices: boolean = false
): Promise<{
  totalEstimatedUSD: number
  txCount: number
  topTokens: Array<{ mint: string; netUsd: number }>
  perTxLogs: Array<{
    signature: string
    timestamp: number | null
    netUsd: number
    transfers: Array<{ mint: string; amount: number; usdValue: number; type: string; ignored?: boolean; from?: string | null; to?: string | null }>
  }>
}> {
  const walletLower = wallet.toLowerCase()
  let totalEstimatedUSD = 0
  const tokenNetUsd = new Map<string, number>()
  const perTxLogs: Array<{
    signature: string
    timestamp: number | null
    netUsd: number
    transfers: Array<{ mint: string; amount: number; usdValue: number }>
  }> = []

  if (verboseLogging) {
    console.log(`\n=== Estimating P&L for ${transactions.length} transactions ===`)
  }

  for (const tx of transactions) {
    const txTimestamp = tx.timestamp
    const txLog: typeof perTxLogs[0] = {
      signature: tx.signature,
      timestamp: txTimestamp,
      netUsd: 0,
      transfers: [],
    }

    // Process token transfers
    for (const transfer of tx.tokenTransfers || []) {
      if (!transfer.mint) continue

      const mint = transfer.mint
      const fromAddr = transfer.fromUserAccount?.toLowerCase() || null
      const toAddr = transfer.toUserAccount?.toLowerCase() || null
      const isIncoming = toAddr === walletLower
      const isOutgoing = fromAddr === walletLower

      if (!isIncoming && !isOutgoing) continue

      const amount = transfer.tokenAmount || transfer.amount || 0
      if (amount === 0) continue

      // Classify transfer type
      let transferType = 'trade'
      let ignored = false
      if (fromAddr && toAddr) {
        const fromOwned = userWallets.has(fromAddr)
        const toOwned = userWallets.has(toAddr)
        const toExchange = knownExchanges.has(toAddr)
        const fromExchange = knownExchanges.has(fromAddr)
        if (fromOwned && toOwned) {
          transferType = 'internal_transfer'
          ignored = !includeInternal
        } else if (fromOwned && toExchange) {
          transferType = 'cash_out'
          ignored = !includeInternal
        } else if (fromExchange && toOwned) {
          transferType = 'cash_in'
          // treat as deposit; does not affect P&L
          ignored = !includeInternal
        }
      }

      // Use pre-fetched current price (MUCH FASTER - no API calls in loop!)
      // Skip historical price lookup for speed - use current price for all transactions
      // This eliminates thousands of sequential API calls that were killing performance!
      let priceUsd = currentPrices.get(mint) || null
      
      if (priceUsd === null && mint === SOL_MINT) {
        // Default SOL price if not available
        priceUsd = 100
      }
      
      // Skip if we still don't have a price (don't make API call here - already fetched)
      if (priceUsd === null || priceUsd === 0) {
        if (debugPrices) {
          console.warn(`No price available for ${mint} at tx ${tx.signature.substring(0, 8)}...`)
        }
        if (!includeInternal) {
          // mark as ignored unknown priced transfer
          txLog.transfers.push({ mint, amount: isIncoming ? amount : -amount, usdValue: 0, type: 'unpriced', ignored: true, from: fromAddr, to: toAddr })
          continue
        }
      }

      // Calculate USD value
      // For SPL tokens, amount is usually in raw units (need decimals), but Helius might give us UI amount
      // For simplicity, assume amount is already in UI units or use a reasonable default
      // TODO: Use token metadata decimals for proper conversion
      const usdValue = Number(((isIncoming ? 1 : -1) * amount * priceUsd).toFixed(2)) // Format USD to 2 decimals

      txLog.transfers.push({
        mint,
        amount: isIncoming ? amount : -amount,
        usdValue,
        type: transferType,
        ignored,
        from: fromAddr,
        to: toAddr,
      })

      if (!ignored) {
        txLog.netUsd += usdValue
        totalEstimatedUSD += usdValue
      }

      // Track per-token totals
      const current = tokenNetUsd.get(mint) || 0
      if (!ignored) tokenNetUsd.set(mint, current + usdValue)
    }

    // Process native SOL transfers
    for (const transfer of tx.nativeTransfers || []) {
      const amount = transfer.amount || 0
      if (amount === 0) continue

      const isIncoming = transfer.toUserAccount?.toLowerCase() === walletLower
      const isOutgoing = transfer.fromUserAccount?.toLowerCase() === walletLower

      if (!isIncoming && !isOutgoing) continue

      // Convert lamports to SOL (1 SOL = 1e9 lamports)
      const solAmount = amount / 1e9

      // Get SOL price
      // Use pre-fetched SOL price (no API call)
      let solPrice = currentPrices.get(SOL_MINT) || 100

      // Try historical price if timestamp available
      if (txTimestamp && solPrice) {
        try {
          const timestampSeconds = txTimestamp
          const startTimeSeconds = timestampSeconds - 3600
          const endTimeSeconds = timestampSeconds + 3600

          const candles = await priceService.getCandles({
            tokenMint: SOL_MINT,
            start: startTimeSeconds * 1000, // Convert to milliseconds for getCandles API
            end: endTimeSeconds * 1000,
            resolution: '1h',
          })

          // candle.t is in seconds, compare with timestampSeconds
          if (candles.length > 0) {
            const closestCandle = candles.reduce((closest, candle) => {
              const closestDiff = Math.abs(closest.t - timestampSeconds)
              const candleDiff = Math.abs(candle.t - timestampSeconds)
              return candleDiff < closestDiff ? candle : closest
            })
            solPrice = closestCandle.c
          }
        } catch (error) {
          // Use current price as fallback
        }
      }

      const usdValue = Number(((isIncoming ? 1 : -1) * solAmount * solPrice).toFixed(2)) // Format USD to 2 decimals

      // Classification for native transfers as well
      const fromAddr = transfer.fromUserAccount?.toLowerCase() || null
      const toAddr = transfer.toUserAccount?.toLowerCase() || null
      let nType = 'trade'
      let nIgnored = false
      if (fromAddr && toAddr) {
        const fromOwned = userWallets.has(fromAddr)
        const toOwned = userWallets.has(toAddr)
        const toExchange = knownExchanges.has(toAddr)
        const fromExchange = knownExchanges.has(fromAddr)
        if (fromOwned && toOwned) {
          nType = 'internal_transfer'
          nIgnored = !includeInternal
        } else if (fromOwned && toExchange) {
          nType = 'cash_out'
          nIgnored = !includeInternal
        } else if (fromExchange && toOwned) {
          nType = 'cash_in'
          nIgnored = !includeInternal
        }
      }

      txLog.transfers.push({
        mint: SOL_MINT,
        amount: Number((isIncoming ? solAmount : -solAmount).toFixed(6)), // Format SOL to 6 decimals
        usdValue,
        type: nType,
        ignored: nIgnored,
        from: fromAddr,
        to: toAddr,
      })

      if (!nIgnored) {
        txLog.netUsd += usdValue
        totalEstimatedUSD += usdValue
      }

      const current = tokenNetUsd.get(SOL_MINT) || 0
      if (!nIgnored) tokenNetUsd.set(SOL_MINT, current + usdValue)
    }

    // Subtract transaction fees as SOL
    if (tx.fee && tx.fee > 0) {
      const feeSol = Number((tx.fee / 1e9).toFixed(6)) // Format SOL to 6 decimals
      // Use pre-fetched SOL price (no API call)
      let solPrice = currentPrices.get(SOL_MINT) || 100
      const feeUsd = Number((feeSol * solPrice).toFixed(2)) // Format USD to 2 decimals
      txLog.netUsd -= feeUsd
      totalEstimatedUSD -= feeUsd

      const current = tokenNetUsd.get(SOL_MINT) || 0
      tokenNetUsd.set(SOL_MINT, current - feeUsd)
    }

    if (txLog.transfers.length > 0) {
      perTxLogs.push(txLog)
      // Only log per-transaction P&L if verbose mode enabled
      if (verboseLogging) {
        console.log(`Tx ${tx.signature.substring(0, 8)}...: ${txLog.netUsd >= 0 ? '+' : ''}$${txLog.netUsd.toFixed(2)} USD`)
      }
    }
  }

  // Get top tokens by absolute USD value
  const topTokens = Array.from(tokenNetUsd.entries())
    .map(([mint, netUsd]) => ({ mint, netUsd: Number(netUsd.toFixed(2)) })) // Format USD to 2 decimals
    .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd))
    .slice(0, 10)

  if (verboseLogging) {
    console.log(`Total estimated net USD: ${totalEstimatedUSD >= 0 ? '+' : ''}$${Number(totalEstimatedUSD.toFixed(2))}`)
    console.log(`=== End P&L estimation ===\n`)
  }

  return {
    totalEstimatedUSD: Number(totalEstimatedUSD.toFixed(2)), // Format USD to 2 decimals
    txCount: perTxLogs.length,
    topTokens,
    perTxLogs,
  }
}

export type AnalyzeResponse = {
  wallet: string
  summary: {
    totalRealizedUsd: number
    totalPeakPotentialUsd: number
    totalRegretGapUsd: number
    openPositionsUsd: number
    // Simple P&L estimation fields
    totalEstimatedUSD: number
    estimatedTxCount: number
    topTokens: Array<{ mint: string; netUsd: number }>
  }
  tokens: Array<{
    tokenMint: string
    symbol: string
    realizedUsd: number
    peakPotentialUsd: number
    regretGapUsd: number
    lots: Array<{
      lotId: string
      buyTime: number
      buyQty: number
      buyCostUsd?: number
      realizedUsd: number
      peakTimestamp: number | null
      peakPriceUsd: number | null
      peakPotentialUsd: number
      regretGapUsd: number
      matchedSells: Array<{ time: number; qty: number; proceedsUsd?: number }>
    }>
  }>
  // Simplified transaction data for frontend display
  transactions: Array<{
    signature: string
    timestamp: number | null
    netUsd: number
    transferCount: number
    topTransfer: {
      mint: string
      amount: number
      usdValue: number
    } | null
  }>
  totalTransactions: number
  // Detailed P&L estimation (only in development mode)
  estimatedPAndL?: {
    totalEstimatedUSD: number
    txCount: number
    topTokens: Array<{ mint: string; netUsd: number }>
    perTxLogs: Array<{
      signature: string
      timestamp: number | null
      netUsd: number
      transfers: Array<{ mint: string; amount: number; usdValue: number }>
    }>
  }
}

export async function GET(request: NextRequest) {
  try {
    // Runtime logging controls
    const VERBOSE_LOGGING = process.env.VERBOSE === 'true'
    const DEBUG_PRICES = process.env.DEBUG_PRICES === 'true'
    const IS_DEV = process.env.NODE_ENV !== 'production'
    
    const apiKey = process.env.HELIUS_API_KEY ?? ""
    
    const { searchParams } = new URL(request.url)
    const rawWallet = searchParams.get('wallet')
    const txLimitParam = searchParams.get('limit')
    const txLimit = txLimitParam ? parseInt(txLimitParam, 10) : 0 // 0 = unlimited by default
    const skipPnl = searchParams.get('skipPnl') === 'true' // Option to skip expensive P&L calc

    if (!rawWallet) {
      return NextResponse.json(
        { code: 'MISSING_WALLET', message: 'Wallet address is required' },
        { status: 400 }
      )
    }

    // Validate wallet address using the new schema
    let wallet: string
    try {
      wallet = WalletAddressSchema.parse(rawWallet)
    } catch (e: any) {
      return NextResponse.json(
        { code: "INVALID_WALLET", message: "Invalid Solana wallet address" },
        { status: 400 }
      )
    }

    // Use deduplication and caching
    const response = await analyzeOnce(wallet, async () => {
      const apiKey = process.env.HELIUS_API_KEY ?? ""
      
      const heliusClient = new HeliusClient()
      const solscanClient = new SolscanClient()
      const priceService = createPriceService()
      // Self-transfer config
      const INCLUDE_INTERNAL_TRANSFERS = process.env.INCLUDE_INTERNAL_TRANSFERS === 'true'
      const autoLinkParam = searchParams.get('autoLink')
      const AUTO_LINKED = autoLinkParam ? autoLinkParam === 'true' : true // default on
      const linked = (searchParams.get('linked') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

      // Infer linked wallets by bilateral flow heuristic
      const inferLinkedWallets = (txs: HeliusTransaction[], primary: string): Set<string> => {
        const primaryLc = primary.toLowerCase()
        const sentCount = new Map<string, number>()
        const recvCount = new Map<string, number>()

        for (const tx of txs) {
          // Native transfers
          for (const nt of tx.nativeTransfers ?? []) {
            const fromLc = (nt.fromUserAccount || '').toLowerCase()
            const toLc = (nt.toUserAccount || '').toLowerCase()
            if (!fromLc || !toLc) continue
            if (fromLc === primaryLc) sentCount.set(toLc, (sentCount.get(toLc) || 0) + 1)
            if (toLc === primaryLc) recvCount.set(fromLc, (recvCount.get(fromLc) || 0) + 1)
          }
          // Token transfers
          for (const tt of tx.tokenTransfers ?? []) {
            const fromLc = (tt.fromUserAccount || '').toLowerCase()
            const toLc = (tt.toUserAccount || '').toLowerCase()
            if (!fromLc || !toLc) continue
            if (fromLc === primaryLc) sentCount.set(toLc, (sentCount.get(toLc) || 0) + 1)
            if (toLc === primaryLc) recvCount.set(fromLc, (recvCount.get(fromLc) || 0) + 1)
          }
        }
        const linked = new Set<string>()
        // Thresholds: at least 3 sends and 3 receives (bilateral), and total >= 6
        for (const addr of new Set<string>([...sentCount.keys(), ...recvCount.keys()])) {
          const s = sentCount.get(addr) || 0
          const r = recvCount.get(addr) || 0
          if (s >= 3 && r >= 3 && s + r >= 6) linked.add(addr)
        }
        return linked
      }

      // Minimal seed of known exchange hot wallets (examples; expandable / fetchable)
      const knownExchanges = new Set<string>([
        // Placeholders; replace with curated lists
        // Coinbase (example routing wallets would go here)
        // Binance, Kraken, Bybit hot wallets, etc.
      ].map(s => s.toLowerCase()))

      // Fetch transactions (unlimited by default, or limited if specified)
      let transactions: HeliusTransaction[]
      if (txLimit > 0) {
        console.log(`Fetching up to ${txLimit} transactions for wallet: ${wallet}`)
        transactions = await heliusClient.getTransactionsWithLimit(wallet, txLimit)
      } else {
        console.log(`Fetching ALL transactions for wallet: ${wallet}`)
        transactions = await heliusClient.getAllTransactions(wallet)
      }
    
      // Collect structured numeric transaction data
      // Store full addresses for complete numeric analysis
      const structuredTxs: Array<{
        id: number
        slot: number
        timestamp: string | null
        timestamp_unix: number | null
        fee_lamports: number
        fee_sol: number
        token_transfers: Array<{
          mint: string  // Full mint address
          symbol?: string
          from: string | null
          to: string | null
          amount: number  // Raw token amount
        }>
        native_transfers: Array<{
          from: string | null
          to: string | null
          amount_lamports: number
          amount_sol: number
        }>
      }> = []

      // Solscan-style filtering: Only count successful transactions, exclude vote/compute budget
      const VOTE_PROGRAM_ID = 'Vote111111111111111111111111111111111111111'
      const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111'
      const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

      // Filter transactions according to Solscan methodology
      const validTransactions = transactions.filter((tx) => {
        // Skip transactions with errors (if Helius provides error info)
        // Check multiple possible error field locations (Helius Enhanced API structure varies)
        const txAny = tx as any
        if (txAny.meta?.err || txAny.error || txAny.err || txAny.failed) {
          return false
        }

        // Exclude transactions that are ONLY vote or compute budget instructions
        // Check if all instructions are vote/compute budget
        const instructions = tx.instructions || []
        if (instructions.length > 0) {
          const allProgramIds = instructions
            .map((inst: any) => inst.programId)
            .filter(Boolean)
            .map((progId: string) => progId.trim())
          
          // If ALL instructions are vote or compute budget, exclude this transaction
          if (allProgramIds.length > 0 && 
              allProgramIds.every((id: string) => 
                id === VOTE_PROGRAM_ID || id === COMPUTE_BUDGET_PROGRAM_ID
              )) {
            return false
          }
        }

        return true
      })

      console.log(`Filtered ${transactions.length - validTransactions.length} invalid transactions (failed/vote/compute-only), ${validTransactions.length} valid transactions`)

      // Deduplicate transactions by signature (Solscan counts one per unique signature)
      const seenSignatures = new Set<string>()
      const deduplicatedTransactions = validTransactions.filter((tx) => {
        if (seenSignatures.has(tx.signature)) {
          return false // Skip duplicate
        }
        seenSignatures.add(tx.signature)
        return true
      })

      // Build user wallet set after deduplication (used for classification)
      const autoLinked = AUTO_LINKED ? inferLinkedWallets(deduplicatedTransactions, wallet) : new Set<string>()
      const userWallets = new Set<string>([wallet.toLowerCase(), ...linked, ...autoLinked])

      if (deduplicatedTransactions.length < validTransactions.length) {
        console.log(`Removed ${validTransactions.length - deduplicatedTransactions.length} duplicate transaction signatures`)
      }

      console.log(`Processing ${deduplicatedTransactions.length} unique transactions...`)

      let totalSolTransferred = 0
      let totalTokenTransfers = 0
      let totalNativeTransfers = 0
      let totalFeeLamports = 0

      // Log each transaction once in development mode
      if (IS_DEV) {
        console.log('\n=== TRANSACTION LOG ===')
      }

      deduplicatedTransactions.forEach((tx, index) => {
        // Log each transaction once (development mode only)
        if (IS_DEV) {
          const tokenCount = tx.tokenTransfers?.length || 0
          const nativeCount = tx.nativeTransfers?.length || 0
          const dateStr = tx.timestamp ? new Date(tx.timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19) + 'Z' : 'N/A'
          const sigShort = tx.signature.substring(0, 16) + '...'
          console.log(`Tx ${String(index + 1).padStart(5)}: ${sigShort.padEnd(20)} | Slot: ${String(tx.slot).padStart(9)} | ${dateStr} | T:${String(tokenCount).padStart(2)} N:${String(nativeCount).padStart(2)} | Fee: ${String(tx.fee || 0).padStart(8)}`)
        }
        const tokenTransfers: Array<{
          mint: string  // Full mint address
          symbol?: string
          from: string | null
          to: string | null
          amount: number
        }> = []

        const nativeTransfers: Array<{
          from: string | null
          to: string | null
          amount_lamports: number
          amount_sol: number
        }> = []

        // Process token transfers (SPL tokens)
        // Solscan counts only SPL token program transfers (spl-token)
        // Helius Enhanced API's tokenTransfers should already be filtered, but we count them
        if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
          tx.tokenTransfers.forEach((transfer) => {
            if (transfer.mint && typeof transfer.tokenAmount === 'number') {
              // Count as SPL token transfer (Helius already filters to top-level transfers)
              tokenTransfers.push({
                mint: transfer.mint,  // Full address for algorithm parsing
                from: transfer.fromUserAccount || null,
                to: transfer.toUserAccount || null,
                amount: transfer.tokenAmount
              })
              totalTokenTransfers++
            }
          })
        }

        // Process native SOL transfers
        // Solscan counts only system program transfers (not internal CPI calls)
        // Helius Enhanced API's nativeTransfers should already be filtered to top-level transfers
        if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
          tx.nativeTransfers.forEach((transfer) => {
            if (typeof transfer.amount === 'number' && transfer.amount > 0) {
              const solAmount = transfer.amount / 1e9 // Convert lamports to SOL
              nativeTransfers.push({
                from: transfer.fromUserAccount || null,
                to: transfer.toUserAccount || null,
                amount_lamports: transfer.amount,
                amount_sol: solAmount // Keep full precision until JSON output
              })
              totalSolTransferred += solAmount
              totalNativeTransfers++
            }
          })
        }

        const fee = tx.fee || 0
        const feeSol = fee / 1e9
        totalFeeLamports += fee

        structuredTxs.push({
          id: index + 1,
          slot: tx.slot,
          timestamp: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : null,
          timestamp_unix: tx.timestamp || null,
          fee_lamports: fee,
          fee_sol: feeSol,
          token_transfers: tokenTransfers,
          native_transfers: nativeTransfers
        })
      })

      // Close transaction log section
      if (IS_DEV) {
        console.log(`=== END TRANSACTION LOG (${deduplicatedTransactions.length} transactions) ===\n`)
      }

      // Calculate summary with precise numeric values (Solscan-style counting)
      // Format: 6 decimals for SOL, 2 decimals for USD
      const successfulTxCount = deduplicatedTransactions.length // Count unique successful transaction signatures
      const summary = {
        total_sol_transferred: Number(totalSolTransferred.toFixed(6)),
        total_lamports_transferred: Number((totalSolTransferred * 1e9).toFixed(0)),
        total_token_transfers: totalTokenTransfers, // Count of SPL token transfer instructions
        total_native_transfers: totalNativeTransfers, // Count of system program transfer instructions
        total_fee_lamports: totalFeeLamports,
        total_fee_sol: Number((totalFeeLamports / 1e9).toFixed(6)),
        average_fee_lamports: successfulTxCount > 0 ? Number((totalFeeLamports / successfulTxCount).toFixed(0)) : 0,
        average_fee_sol: successfulTxCount > 0 ? Number((totalFeeLamports / successfulTxCount / 1e9).toFixed(6)) : 0,
        total_transactions: successfulTxCount // Unique successful transaction signatures (Solscan-style)
      }
    
      if (validTransactions.length === 0) {
        return {
          wallet,
          summary: {
            totalRealizedUsd: 0,
            totalPeakPotentialUsd: 0,
            totalRegretGapUsd: 0,
            openPositionsUsd: 0,
            totalEstimatedUSD: 0,
            estimatedTxCount: 0,
            topTokens: [],
          },
          tokens: [],
          transactions: [],
          totalTransactions: 0,
        }
      }

      // Extract unique token mints from deduplicated transactions only (Solscan-style)
      const tokenMints = new Set<string>()
      const decimalsHints = new Map<string, number>()
      
      for (const tx of deduplicatedTransactions) {
        // Add SPL token mints from tokenTransfers
        for (const t of tx.tokenTransfers ?? []) {
          if (t.mint) {
            tokenMints.add(t.mint)
          }
        }
        // Always include SOL
        tokenMints.add("So11111111111111111111111111111111111111112")
      }

      // Fetch token metadata using resilient service
      console.log(`Fetching metadata for ${tokenMints.size} tokens`)
      const metadataMap = await getBatchTokenMeta(Array.from(tokenMints), apiKey, decimalsHints)

      // Also fetch token symbols from database for structured output
      const tokenSymbolsMap = new Map<string, string>()
      try {
        const tokenMetas = await prisma.tokenMeta.findMany({
          where: {
            tokenMint: {
              in: Array.from(tokenMints)
            }
          },
          select: {
            tokenMint: true,
            symbol: true
          }
        })
        tokenMetas.forEach(meta => {
          if (meta.symbol) {
            tokenSymbolsMap.set(meta.tokenMint, meta.symbol)
          }
        })
      } catch (err: any) {
        console.warn('Could not fetch token symbols from database:', err.message)
      }
      
      // Also add symbols from metadataMap
      for (const [mint, metadata] of metadataMap) {
        if (metadata.symbol && !tokenSymbolsMap.has(mint)) {
          tokenSymbolsMap.set(mint, metadata.symbol)
        }
      }

      // Ensure summary numeric formatting matches (6 decimals SOL, 2 decimals USD in display)
      // The summary object already has correct formatting from above

      // Enhance structured transactions with token symbols BEFORE output
      structuredTxs.forEach((tx) => {
        tx.token_transfers = tx.token_transfers.map(transfer => {
          const symbol = tokenSymbolsMap.get(transfer.mint) || null
          return { ...transfer, symbol }
        })
      })

      // Output structured JSON for algorithm parsing (only in development mode)
      if (IS_DEV) {
        console.log('\n=== STRUCTURED TRANSACTION DATA (JSON FORMAT) ===')
        const jsonOutput = {
          transactions: structuredTxs.map(tx => ({
            id: tx.id,
            slot: tx.slot,
            timestamp: tx.timestamp,
            timestamp_unix: tx.timestamp_unix,
            fee_lamports: tx.fee_lamports,
            fee_sol: Number(tx.fee_sol.toFixed(6)), // 6 decimals for SOL
            token_transfers: tx.token_transfers.map(t => ({
              mint: t.mint,
              symbol: t.symbol || null,
              from: t.from,
              to: t.to,
              amount: Number(t.amount.toFixed(6)) // 6 decimals for token amounts
            })),
            native_transfers: tx.native_transfers.map(nt => {
              // Preserve precision for very small amounts - use more decimals if needed
              let solValue: number
              if (nt.amount_sol < 0.000001 && nt.amount_sol > 0) {
                // For very small amounts, preserve more precision (up to 9 decimals)
                solValue = Number(nt.amount_sol.toFixed(9))
              } else {
                solValue = Number(nt.amount_sol.toFixed(6))
              }
              return {
                from: nt.from,
                to: nt.to,
                amount_lamports: nt.amount_lamports,
                amount_sol: solValue
              }
            })
          })),
          summary: summary
        }
        const jsonString = JSON.stringify(jsonOutput, null, 2)
        console.log(jsonString)
        console.log('=== END STRUCTURED JSON DATA ===\n')

        // Optionally write to file if requested
        if (process.env.SAVE_ANALYSIS_JSON === 'true') {
          try {
            const fs = await import('fs/promises')
            const path = await import('path')
            const filePath = path.join(process.cwd(), 'analysis.json')
            await fs.writeFile(filePath, jsonString, 'utf-8')
            console.log(`💾 Analysis JSON saved to: ${filePath}\n`)
          } catch (err) {
            console.warn('Could not save analysis JSON to file:', err)
          }
        }
      }

      // Always show human-readable summary table (production-friendly)
      console.log('\n=== TRANSACTION SUMMARY TABLE ===')
      console.log(`Total Transactions: ${summary.total_transactions}`)
      console.log(`Token Transfers: ${summary.total_token_transfers}`)
      console.log(`Native Transfers: ${summary.total_native_transfers}`)
      console.log(`Total SOL Transferred: ${summary.total_sol_transferred} SOL (${summary.total_lamports_transferred.toLocaleString()} lamports)`)
      console.log(`Total Fees: ${summary.total_fee_sol} SOL (${summary.total_fee_lamports.toLocaleString()} lamports)`)
      console.log(`Average Fee: ${summary.average_fee_sol} SOL (${summary.average_fee_lamports} lamports)`)
      console.log('=== END SUMMARY TABLE ===\n')

      // Cache token metadata in database (with graceful error handling) - batch in parallel
      const dbWritePromises = Array.from(metadataMap.entries()).map(async ([mint, metadata]) => {
        try {
        await prisma.tokenMeta.upsert({
          where: { tokenMint: mint },
          update: {
            symbol: metadata.symbol,
            decimals: metadata.decimals,
          },
          create: {
            tokenMint: mint,
            symbol: metadata.symbol,
            decimals: metadata.decimals,
          },
        })
        } catch (err: any) {
          console.warn(`Skipping Prisma write for ${mint}:`, err.message)
          // Continue processing even if database write fails
        }
      })
      
      // Don't await database writes - let them happen in background for faster response
      Promise.allSettled(dbWritePromises).catch(() => {
        // Silently handle any errors, writes are non-critical for response
      })

      // Normalize deduplicated transactions only (Solscan-style)
      const normalizer = new TransactionNormalizer()
      const activities = await normalizer.normalizeTransactions(deduplicatedTransactions, wallet)
      
      console.log(`\nPipeline counts: txs=${deduplicatedTransactions.length} (${transactions.length} total before filtering/dedup), activities=${activities.length}, tokens=${tokenMints.size}`)

      // Get current prices for all tokens in parallel (MUCH FASTER)
      console.log(`Fetching prices for ${tokenMints.size} tokens in parallel...`)
      const pricePromises = Array.from(tokenMints).map(async (mint) => {
        try {
          const price = await priceService.getCurrentPriceUsd(mint)
          return { mint, price }
        } catch (error) {
          return { mint, price: null }
        }
      })
      
      const priceResults = await Promise.allSettled(pricePromises)
      const currentPrices = new Map<string, number>()
      
      priceResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.price) {
          currentPrices.set(result.value.mint, result.value.price)
        }
      })
      
      // Always ensure SOL price is available
      if (!currentPrices.has("So11111111111111111111111111111111111111112")) {
        const solPrice = await priceService.getCurrentPriceUsd("So11111111111111111111111111111111111111112")
        if (solPrice) {
          currentPrices.set("So11111111111111111111111111111111111111112", solPrice)
        }
      }

      console.log(`Fetched ${currentPrices.size} prices successfully`)

      // Simple P&L estimation (requested feature) - using deduplicated transactions only
      // Skip if requested for faster initial response
      let pnlEstimate
      if (!skipPnl) {
        console.log('Running simple P&L estimation (using pre-fetched prices)...')
        pnlEstimate = await estimateSimplePAndL(
          deduplicatedTransactions,
          wallet,
          priceService,
          currentPrices,
          userWallets,
          knownExchanges,
          INCLUDE_INTERNAL_TRANSFERS,
          VERBOSE_LOGGING,
          DEBUG_PRICES
        )
      } else {
        console.log('Skipping P&L estimation for faster response')
        pnlEstimate = {
          totalEstimatedUSD: 0,
          txCount: deduplicatedTransactions.length,
          topTokens: [],
          perTxLogs: []
        }
      }

      // Reconstruct positions (existing detailed analysis)
      // Skip if requested for faster initial response
      let result
      if (!skipPnl) {
      console.log('Reconstructing positions...')
      const reconstructor = new PositionReconstructor(priceService)
        result = await reconstructor.reconstructPositions(activities, currentPrices)
        console.log(`Reconstruction result: ${result.tokens.length} tokens, summary:`, result.summary)
      } else {
        console.log('Skipping position reconstruction for faster response')
        result = {
          summary: {
            totalRealizedUsd: 0,
            totalPeakPotentialUsd: 0,
            totalRegretGapUsd: 0,
            openPositionsUsd: 0,
          },
          tokens: []
        }
      }

      // Create simplified transaction array for frontend display
      // - Exclude fee-only or zero-impact transactions
      // - Enrich with token symbol and Solscan URL
      const mintToSymbol = (mint: string | undefined | null): string | null => {
        if (!mint) return null
        return tokenSymbolsMap.get(mint) || (mint === "So11111111111111111111111111111111111111112" ? 'SOL' : null)
      }

      const EPS_AMOUNT = 1e-9
      const EPS_USD = 1e-6

      const simplifiedTransactions = pnlEstimate.perTxLogs
        .filter((txLog) => {
          const hasNonZeroTransfer = txLog.transfers.some(t => Math.abs(t.amount) > EPS_AMOUNT)
          const hasMeaningfulPnl = Math.abs(txLog.netUsd) > EPS_USD
          return hasNonZeroTransfer || hasMeaningfulPnl
        })
        .slice(0, 100)
        .map((txLog) => {
          const top = txLog.transfers[0] as { mint: string; amount: number; usdValue: number }
          const symbol = mintToSymbol(top?.mint)
          return {
            signature: txLog.signature,
            solscanUrl: `https://solscan.io/tx/${txLog.signature}`,
            timestamp: txLog.timestamp,
            netUsd: txLog.netUsd,
            transferCount: txLog.transfers.length,
            token: symbol,
            topTransfer: top
              ? {
                  mint: top.mint,
                  amount: top.amount,
                  usdValue: top.usdValue,
                }
              : null,
          }
        })

      return {
        wallet,
        summary: {
          ...result.summary,
          // Add simple P&L estimate to summary
          totalEstimatedUSD: pnlEstimate.totalEstimatedUSD,
          estimatedTxCount: pnlEstimate.txCount,
          topTokens: pnlEstimate.topTokens,
        },
        tokens: result.tokens,
        // Simplified transaction data for frontend display
        transactions: simplifiedTransactions,
        totalTransactions: deduplicatedTransactions.length, // Solscan-style: unique successful transaction signatures
        // Include detailed per-transaction logs in dev mode
        ...(process.env.NODE_ENV === 'development' ? { estimatedPAndL: pnlEstimate } : {}),
      }
    })

    return NextResponse.json(response)
  } catch (error) {
    // Handle validation errors specifically
    if ((error as any)?.issues) {
      return NextResponse.json(
        { code: 'INVALID_WALLET', message: 'Invalid Solana wallet address' },
        { status: 400 }
      )
    }
    
    console.error('Error analyzing wallet:', error)
    
    // Surface specific Helius errors in development
    if (process.env.NODE_ENV === "development" && error instanceof ApiHttpError) {
      // Handle rate limiting (429)
      if (error.status === 429) {
        return NextResponse.json(
          { 
            code: "RATE_LIMITED", 
            message: "Rate limited by Helius API. Please try again in a few minutes.",
            hint: error.hint,
          },
          { status: 429 }
        )
      }
      
      return NextResponse.json(
        { 
          code: "ANALYSIS_ERROR", 
          message: error.message, 
          hint: error.hint, 
          status: error.status, 
          body: error.body 
        },
        { status: 500 }
      )
    }
    
    // Handle rate limiting in production
    if (error instanceof ApiHttpError && error.status === 429) {
      return NextResponse.json(
        { 
          code: "RATE_LIMITED", 
          message: "Rate limited by Helius API. Please try again in a few minutes.",
        },
        { status: 429 }
      )
    }
    
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { code: 'ANALYSIS_ERROR', message: msg },
      { status: 500 }
    )
  }
}
