// Core types for the Solana transaction indexer

export interface HeliusTransaction {
  signature: string
  slot: number
  blockTime: number | null
  meta: {
    err: any
    fee: number
    preBalances: number[]
    postBalances: number[]
    preTokenBalances?: Array<{
      accountIndex: number
      mint: string
      owner: string
      programId: string
      uiTokenAmount: {
        amount: string
        decimals: number
        uiAmount: number | null
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
        uiAmount: number | null
        uiAmountString: string
      }
    }>
    innerInstructions?: Array<{
      index: number
      instructions: Array<{
        programIdIndex: number
        accounts: number[]
        data: string
      }>
    }>
    logMessages?: string[]
  }
  transaction: {
    message: {
      accountKeys: string[]
      instructions: Array<{
        programIdIndex: number
        accounts: number[]
        data: string
      }>
      addressTableLookups?: any[]
    }
    signatures: string[]
  }
  version?: number
}

export interface HeliusResponse {
  items: HeliusTransaction[]
  nextBefore?: string
}

export interface WalletEvent {
  wallet: string
  signature: string
  index: number
  slot: number
  blockTime: number | null
  program: string | null
  type: 'BUY' | 'SELL' | 'SWAP' | 'TRANSFER' | 'MINT' | 'BURN' | 'WRAP' | 'UNWRAP' | 'ATA_CREATE' | 'ATA_CLOSE' | 'UNKNOWN'
  direction: 'IN' | 'OUT' | 'SELF' | 'N/A'
  tokenMint: string | null
  tokenSymbol: string | null
  tokenDecimals: number | null
  amountRaw: string | null
  amountUi: number | null
  amountUsd: number | null
  priceUsdAtTx: number | null
  meta: Record<string, any> | null
}

export interface IndexerStats {
  pagesFetched: number
  rawTxCount: number
  walletTxCount: number
  retryCount: number
  durationMs: number
  lastBefore: string | null
  verifiedSlot: number | null
  firstSlot: number | null
  lastSlot: number | null
}

export interface SyncState {
  id: string
  wallet: string
  lastBefore: string | null
  verifiedSlot: number | null
  fullScanAt: Date | null
  updatedAt: Date
  createdAt: Date
}

export interface ReconcileResult {
  wallet: string
  fromSlot: number
  toSlot: number
  countRaw: number
  countWalletTx: number
  hash: string
  ok: boolean
  missingSignatures: string[]
}

// Program IDs for classification
export const PROGRAM_IDS = {
  SYSTEM: '11111111111111111111111111111111',
  TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  JUPITER_V4: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  SERUM_DEX: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  METEORA_DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  METEORA_POOLS: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  PHOENIX: 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqk89FkACWeBTLU',
  OPENBOOK: 'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',
  MARGINFI: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
  KAMINO: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
  SOLEND: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
  MARINADE: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
  LIDO: 'CrX7kMhLC3cSsXJdT7JDgqrRVWGnUpX3gfEfxxU2NVLi',
  JITO: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',
  WORMHOLE: 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',
  WORMHOLE_CORE: '3u8hJUVTA4jH1wYAQUQxNqXURyoV5QyRBDogdG3AhfpS',
  WORMHOLE_TOKEN: 'DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe',
  PYTECH: 'PyTec6vWUqJhQJqJqJqJqJqJqJqJqJqJqJqJqJqJqJq',
  DRIFT: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
  ZETA: 'ZETAxsqBRek56DhiGXrn75yj2NHU3aYUnxvHXpkf3aD',
  MARGINFI_V2: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
} as const

export type ProgramId = typeof PROGRAM_IDS[keyof typeof PROGRAM_IDS]
