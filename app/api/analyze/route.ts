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

export type AnalyzeResponse = {
  wallet: string
  summary: {
    totalRealizedUsd: number
    totalPeakPotentialUsd: number
    totalRegretGapUsd: number
    openPositionsUsd: number
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
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.HELIUS_API_KEY ?? ""
    
    const { searchParams } = new URL(request.url)
    const rawWallet = searchParams.get('wallet')

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

      // Fetch all transactions
      console.log(`Fetching transactions for wallet: ${wallet}`)
      const transactions = await heliusClient.getAllTransactions(wallet)
    
      if (transactions.length === 0) {
        return {
          wallet,
          summary: {
            totalRealizedUsd: 0,
            totalPeakPotentialUsd: 0,
            totalRegretGapUsd: 0,
            openPositionsUsd: 0,
          },
          tokens: [],
        }
      }

      // Extract unique token mints from enhanced transactions and collect decimal hints
      const tokenMints = new Set<string>()
      const decimalsHints = new Map<string, number>()
      
      for (const tx of transactions) {
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

      // Cache token metadata in database
      for (const [mint, metadata] of metadataMap) {
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
      }

      // Normalize transactions
      const normalizer = new TransactionNormalizer()
      const activities = await normalizer.normalizeTransactions(transactions, wallet)
      
      console.log(`Pipeline counts: txs=${transactions.length}, activities=${activities.length}, tokens=${tokenMints.size}`)

      // Get current prices for all tokens
      const currentPrices = new Map<string, number>()
      for (const mint of tokenMints) {
        const price = await priceService.getCurrentPriceUsd(mint)
        if (price) {
          currentPrices.set(mint, price)
        }
      }
      
      // Always ensure SOL price is available
      if (!currentPrices.has("So11111111111111111111111111111111111111112")) {
        const solPrice = await priceService.getCurrentPriceUsd("So11111111111111111111111111111111111111112")
        if (solPrice) {
          currentPrices.set("So11111111111111111111111111111111111111112", solPrice)
        }
      }

      // Reconstruct positions
      console.log('Reconstructing positions...')
      const reconstructor = new PositionReconstructor(priceService)
      const result = await reconstructor.reconstructPositions(activities, currentPrices)
      
      console.log(`Reconstruction result: ${result.tokens.length} tokens, summary:`, result.summary)

      return {
        wallet,
        summary: result.summary,
        tokens: result.tokens,
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
    
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { code: 'ANALYSIS_ERROR', message: msg },
      { status: 500 }
    )
  }
}
