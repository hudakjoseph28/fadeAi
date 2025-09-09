import { NextRequest, NextResponse } from 'next/server'
import { indexer } from '@/lib/indexer/indexer'
import { WalletAddressSchema } from '@/lib/validation/wallet'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rawWallet = searchParams.get('wallet')
    const mode = searchParams.get('mode') || 'backfill'
    const maxPages = searchParams.get('maxPages')

    if (!rawWallet) {
      return NextResponse.json(
        { error: 'Wallet parameter is required' },
        { status: 400 }
      )
    }

    // Validate wallet address
    const wallet = WalletAddressSchema.parse(rawWallet)

    if (!['backfill', 'tail'].includes(mode)) {
      return NextResponse.json(
        { error: 'Mode must be either "backfill" or "tail"' },
        { status: 400 }
      )
    }

    console.log(`Starting indexer run: wallet=${wallet}, mode=${mode}`)

    let stats
    if (mode === 'backfill') {
      const maxPagesNum = maxPages ? parseInt(maxPages) : undefined
      stats = await indexer.backfillWallet(wallet, maxPagesNum)
    } else {
      stats = await indexer.syncTail(wallet)
    }

    return NextResponse.json({
      success: true,
      wallet,
      mode,
      stats,
      timestamp: new Date().toISOString(),
    })

  } catch (error) {
    console.error('Indexer run failed:', error)
    
    if ((error as any)?.issues) {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { 
        error: 'Indexer run failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
