import { HeliusTransaction, WalletEvent, PROGRAM_IDS } from './types'

export function classifyTransaction(
  tx: HeliusTransaction,
  wallet: string
): WalletEvent[] {
  const events: WalletEvent[] = []
  const accountKeys = tx.transaction.message.accountKeys
  const walletIndex = accountKeys.findIndex(key => key === wallet)
  
  if (walletIndex === -1) {
    // Wallet not directly involved in this transaction
    return events
  }

  // Analyze token balance changes
  const tokenEvents = analyzeTokenBalanceChanges(tx, wallet, walletIndex)
  events.push(...tokenEvents)

  // Analyze SOL balance changes
  const solEvents = analyzeSolBalanceChanges(tx, wallet, walletIndex)
  events.push(...solEvents)

  // Analyze inner instructions for complex operations
  const innerEvents = analyzeInnerInstructions(tx, wallet, walletIndex)
  events.push(...innerEvents)

  // If no specific events were found, create a generic event
  if (events.length === 0) {
    events.push({
      wallet,
      signature: tx.signature,
      index: 0,
      slot: tx.slot,
      blockTime: tx.blockTime,
      program: null,
      type: 'UNKNOWN',
      direction: 'N/A',
      tokenMint: null,
      tokenSymbol: null,
      tokenDecimals: null,
      amountRaw: null,
      amountUi: null,
      amountUsd: null,
      priceUsdAtTx: null,
      meta: {
        reason: 'No specific wallet activity detected',
        accountKeys: accountKeys.length,
        instructions: tx.transaction.message.instructions.length,
      },
    })
  }

  return events
}

function analyzeTokenBalanceChanges(
  tx: HeliusTransaction,
  wallet: string,
  walletIndex: number
): WalletEvent[] {
  const events: WalletEvent[] = []
  const preBalances = tx.meta.preTokenBalances || []
  const postBalances = tx.meta.postTokenBalances || []

  // Create maps for easier lookup
  const preBalanceMap = new Map<string, any>()
  const postBalanceMap = new Map<string, any>()

  preBalances.forEach(balance => {
    if (balance.owner === wallet) {
      preBalanceMap.set(balance.mint, balance)
    }
  })

  postBalances.forEach(balance => {
    if (balance.owner === wallet) {
      postBalanceMap.set(balance.mint, balance)
    }
  })

  // Find all mints that the wallet has interacted with
  const allMints = new Set([...preBalanceMap.keys(), ...postBalanceMap.keys()])

  for (const mint of allMints) {
    const preBalance = preBalanceMap.get(mint)
    const postBalance = postBalanceMap.get(mint)

    const preAmount = preBalance ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0') : 0
    const postAmount = postBalance ? parseFloat(postBalance.uiTokenAmount.uiAmountString || '0') : 0
    const delta = postAmount - preAmount

    if (Math.abs(delta) > 0.000001) { // Ignore dust
      const direction = delta > 0 ? 'IN' : 'OUT'
      const type = determineTokenEventType(tx, mint, direction)
      
      events.push({
        wallet,
        signature: tx.signature,
        index: events.length,
        slot: tx.slot,
        blockTime: tx.blockTime,
        program: getProgramFromTransaction(tx),
        type,
        direction,
        tokenMint: mint,
        tokenSymbol: postBalance?.uiTokenAmount.decimals ? 'UNKNOWN' : null,
        tokenDecimals: postBalance?.uiTokenAmount.decimals || preBalance?.uiTokenAmount.decimals || null,
        amountRaw: Math.abs(delta).toString(),
        amountUi: Math.abs(delta),
        amountUsd: null, // Will be filled by price service
        priceUsdAtTx: null,
        meta: {
          preAmount,
          postAmount,
          delta,
          decimals: postBalance?.uiTokenAmount.decimals || preBalance?.uiTokenAmount.decimals,
        },
      })
    }
  }

  return events
}

function analyzeSolBalanceChanges(
  tx: HeliusTransaction,
  wallet: string,
  walletIndex: number
): WalletEvent[] {
  const events: WalletEvent[] = []
  const preBalances = tx.meta.preBalances || []
  const postBalances = tx.meta.postBalances || []

  if (walletIndex >= 0 && walletIndex < preBalances.length && walletIndex < postBalances.length) {
    const preAmount = preBalances[walletIndex] / 1e9 // Convert lamports to SOL
    const postAmount = postBalances[walletIndex] / 1e9
    const delta = postAmount - preAmount

    if (Math.abs(delta) > 0.000001) { // Ignore dust
      const direction = delta > 0 ? 'IN' : 'OUT'
      const type = determineSolEventType(tx, direction)
      
      events.push({
        wallet,
        signature: tx.signature,
        index: events.length,
        slot: tx.slot,
        blockTime: tx.blockTime,
        program: getProgramFromTransaction(tx),
        type,
        direction,
        tokenMint: 'So11111111111111111111111111111111111111112', // WSOL mint
        tokenSymbol: 'SOL',
        tokenDecimals: 9,
        amountRaw: Math.abs(delta).toString(),
        amountUi: Math.abs(delta),
        amountUsd: null, // Will be filled by price service
        priceUsdAtTx: null,
        meta: {
          preAmount,
          postAmount,
          delta,
          isNative: true,
        },
      })
    }
  }

  return events
}

function analyzeInnerInstructions(
  tx: HeliusTransaction,
  wallet: string,
  walletIndex: number
): WalletEvent[] {
  const events: WalletEvent[] = []
  const innerInstructions = tx.meta.innerInstructions || []

  for (const innerIx of innerInstructions) {
    for (const instruction of innerIx.instructions) {
      const programId = tx.transaction.message.accountKeys[instruction.programIdIndex]
      
      // Check for specific program interactions
      if (programId === PROGRAM_IDS.TOKEN || programId === PROGRAM_IDS.TOKEN_2022) {
        // Token program interactions are already covered by balance analysis
        continue
      }

      // Check for DEX interactions
      if (isDexProgram(programId)) {
        const dexEvent = createDexEvent(tx, wallet, programId, events.length)
        if (dexEvent) {
          events.push(dexEvent)
        }
      }
    }
  }

  return events
}

function determineTokenEventType(tx: HeliusTransaction, mint: string, direction: string): WalletEvent['type'] {
  const program = getProgramFromTransaction(tx)
  
  if (program && isDexProgram(program)) {
    return direction === 'IN' ? 'BUY' : 'SELL'
  }
  
  if (program === PROGRAM_IDS.TOKEN || program === PROGRAM_IDS.TOKEN_2022) {
    return 'TRANSFER'
  }

  // Check for mint/burn operations
  if (tx.meta.logMessages?.some(log => log.includes('Transfer') && log.includes('mint'))) {
    return direction === 'IN' ? 'MINT' : 'BURN'
  }

  return 'TRANSFER'
}

function determineSolEventType(tx: HeliusTransaction, direction: string): WalletEvent['type'] {
  const program = getProgramFromTransaction(tx)
  
  if (program === PROGRAM_IDS.SYSTEM) {
    return 'TRANSFER'
  }

  if (program && isDexProgram(program)) {
    return direction === 'IN' ? 'BUY' : 'SELL'
  }

  return 'TRANSFER'
}

function getProgramFromTransaction(tx: HeliusTransaction): string | null {
  const instructions = tx.transaction.message.instructions
  if (instructions.length === 0) return null

  const firstInstruction = instructions[0]
  const programId = tx.transaction.message.accountKeys[firstInstruction.programIdIndex]
  
  return programId
}

function isDexProgram(programId: string): boolean {
  return Object.values(PROGRAM_IDS).includes(programId as any) && 
    !['SYSTEM', 'TOKEN', 'TOKEN_2022'].includes(programId)
}

function createDexEvent(
  tx: HeliusTransaction,
  wallet: string,
  programId: string,
  index: number
): WalletEvent | null {
  // This is a simplified DEX event creation
  // In a real implementation, you'd analyze the specific DEX instruction data
  
  return {
    wallet,
    signature: tx.signature,
    index,
    slot: tx.slot,
    blockTime: tx.blockTime,
    program: programId,
    type: 'SWAP',
    direction: 'N/A',
    tokenMint: null,
    tokenSymbol: null,
    tokenDecimals: null,
    amountRaw: null,
    amountUi: null,
    amountUsd: null,
    priceUsdAtTx: null,
    meta: {
      dexProgram: programId,
      instructionCount: tx.transaction.message.instructions.length,
      innerInstructionCount: tx.meta.innerInstructions?.length || 0,
    },
  }
}
