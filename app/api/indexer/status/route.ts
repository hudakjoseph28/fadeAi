import { NextRequest, NextResponse } from 'next/server'
import { indexer } from '@/lib/indexer/indexer'
import { WalletAddressSchema } from '@/lib/validation/wallet'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rawWallet = searchParams.get('wallet')

    if (!rawWallet) {
      return NextResponse.json(
        { error: 'Wallet parameter is required' },
        { status: 400 }
      )
    }

    // Validate wallet address
    const wallet = WalletAddressSchema.parse(rawWallet)

    const status = await indexer.getIndexerStatus(wallet)
    const metrics = await indexer.getWalletMetrics(wallet)

    return NextResponse.json({
      success: true,
      wallet,
      status,
      metrics,
      timestamp: new Date().toISOString(),
    })

  } catch (error) {
    console.error('Status check failed:', error)
    
    if ((error as any)?.issues) {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { 
        error: 'Status check failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
