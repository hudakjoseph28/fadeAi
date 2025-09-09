import { z } from 'zod'
import { decodeError, ApiError, ApiHttpError } from './errors'
import pRetry from 'p-retry'
import PQueue from 'p-queue'

// Enhanced Transactions schema for Helius
const EnhancedTransfer = z.object({
  mint: z.string().optional(),              // SPL only
  fromUserAccount: z.string().nullable().optional(),
  toUserAccount: z.string().nullable().optional(),
  tokenAmount: z.number().optional(),       // SPL
  amount: z.number().optional(),            // SOL, in lamports
});

const EnhancedSwap = z.object({
  // Helius swap event is nested & varies – keep it loose, we only need tokens/amounts
  // We'll detect swap by existence of events.swap and fall back to program IDs.
}).passthrough();

const EnhancedTx = z.object({
  signature: z.string(),
  slot: z.number(),
  timestamp: z.number().nullable().optional(),
  fee: z.number().optional(),               // lamports
  tokenTransfers: z.array(EnhancedTransfer).optional().default([]),
  nativeTransfers: z.array(EnhancedTransfer).optional().default([]),
  instructions: z.array(z.object({
    programId: z.string().optional(),
  })).optional().default([]),
  events: z.object({
    swap: EnhancedSwap.optional(),
  }).optional().default({}),
  feePayer: z.string().optional(),
}).passthrough();

export const EnhancedResponse = z.array(EnhancedTx);

// Legacy types for backward compatibility
export type HeliusTransaction = z.infer<typeof EnhancedTx>;
export type HeliusResponse = z.infer<typeof EnhancedResponse>;

export class HeliusClient {
  private readonly baseUrl = 'https://api.helius.xyz/v0'
  private readonly apiKey: string
  private readonly queue: PQueue
  private readonly timeout: number
  private readonly pageLimit: number

  constructor() {
    // Read API key from environment
    const apiKey = process.env.HELIUS_API_KEY
    if (!apiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required')
    }
    this.apiKey = apiKey
    
    // Debug: Log API key info
    console.log('HeliusClient constructor - API key length:', apiKey.length, 'preview:', apiKey.slice(0,4), apiKey.slice(-4))

    this.timeout = parseInt(process.env.INDEXER_TIMEOUT_MS || '20000')
    this.pageLimit = parseInt(process.env.INDEXER_PAGE_LIMIT || '1000')
    
    this.queue = new PQueue({ 
      concurrency: 2, // Respect rate limits
      interval: 1000, // 1 second between batches
      intervalCap: 2 // 2 requests per second
    })
  }

  async getParsedTransactions(
    wallet: string,
    before?: string,
    limit = 1000
  ): Promise<{ items: HeliusResponse; nextBefore?: string }> {
    return this.queue.add(async () => 
      pRetry(
        async (): Promise<{ items: HeliusResponse; nextBefore?: string }> => {
          const startTime = Date.now()
          
          // Helius GET endpoint (no limit parameter to avoid 400 error)
          const params = new URLSearchParams({
            'api-key': this.apiKey,
            'maxSupportedTransactionVersion': '0',
          })
          if (before) {
            params.append('before', before)
          }
          const url = `${this.baseUrl}/addresses/${wallet}/transactions?${params.toString()}`
          
          // Log request (without API key)
          const logUrl = url.replace(/api-key=[^&]+/, 'api-key=***')
          console.log(`Helius request: ${logUrl}`)

          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), this.timeout)

          try {
            // Debug: Log the actual API key being sent
            console.log('Sending API key:', JSON.stringify(this.apiKey), 'length:', this.apiKey.length)
            
            const response = await fetch(url, {
              method: 'GET',
              signal: controller.signal,
              headers: {
                'Accept': 'application/json',
              },
            })

            clearTimeout(timeoutId)

            const duration = Date.now() - startTime
            console.log(`Helius response: ${response.status} in ${duration}ms`)

            if (!response.ok) {
              const err = await decodeError(response);
              if (response.status >= 400 && response.status < 500) {
                console.error("Helius error:", err);
                throw new ApiHttpError(err.message, err);
              } else {
                // Retry for 5xx and network errors
                throw new ApiHttpError(err.message, err);
              }
            }

            const data = await response.json()
            
            // Preview first item shape in dev
            if (process.env.NODE_ENV !== 'production') {
              const preview = Array.isArray(data) ? data[0] : data?.transactions?.[0];
              console.log('Helius preview item keys:', preview ? Object.keys(preview) : 'none');
            }
            
            // Parse response structure using Enhanced schema
            const parsed = EnhancedResponse.parse(data);
            
            const items: HeliusTransaction[] = parsed.map(tx => ({
              signature: tx.signature,
              slot: tx.slot,
              timestamp: tx.timestamp ?? null,
              fee: tx.fee ?? 0,
              tokenTransfers: tx.tokenTransfers ?? [],
              nativeTransfers: tx.nativeTransfers ?? [],
              instructions: tx.instructions ?? [],
              events: tx.events ?? {},
              feePayer: tx.feePayer,
            }))

            const nextBefore = items.length > 0 ? items[items.length - 1].signature : null

            console.log(`Fetched ${items.length} transactions, nextBefore: ${nextBefore || 'none'}`)

            return {
              items,
              nextBefore: nextBefore || undefined,
            }
          } catch (error) {
            clearTimeout(timeoutId)
            throw error
          }
        },
        {
          retries: 5,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 10000,
          randomize: true,
          shouldRetry: (error: any) => {
            // Only retry network errors, timeouts, and 5xx/429
            if (error?.name === 'AbortError') return false // AbortError from pRetry
            if (error && typeof error === 'object' && 'status' in error && error.status >= 400 && error.status < 500) return false // 4xx errors
            return true
          },
          onFailedAttempt: (err: any) => {
            const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
            console.warn(`Helius API attempt ${err.attemptNumber} failed: ${msg}`);
          },
        }
      )
    ) as Promise<{ items: HeliusResponse; nextBefore?: string }>
  }

  async getAllTransactions(wallet: string): Promise<HeliusTransaction[]> {
    const allTransactions: HeliusTransaction[] = []
    let before: string | undefined

    console.log(`Starting full backfill for wallet: ${wallet}`)

    while (true) {
      try {
        const response = await this.getParsedTransactions(wallet, before)
        
        if (response.items.length === 0) {
          console.log('No more transactions found, backfill complete')
          break
        }

        allTransactions.push(...response.items)
        before = response.nextBefore ?? undefined

        console.log(`Fetched ${response.items.length} transactions, total: ${allTransactions.length}`)

        // Safety check to prevent infinite loops
        if (allTransactions.length > 100000) {
          console.warn('Reached maximum transaction limit (100k), stopping backfill')
          break
        }
      } catch (error) {
        console.error('Error during backfill:', error)
        throw error
      }
    }

    console.log(`Backfill complete: ${allTransactions.length} total transactions`)
    return allTransactions
  }
}
