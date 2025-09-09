// lib/cache/analyzeCache.ts
import QuickLRU from 'quick-lru'

// Request deduplication - prevent multiple simultaneous calls for same wallet
const inFlight = new Map<string, Promise<any>>()

// LRU cache for analysis results with TTL
const cache = new QuickLRU<string, { result: any; timestamp: number }>({ 
  maxSize: 100 
})

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function analyzeOnce<T>(
  wallet: string, 
  run: () => Promise<T>
): Promise<T> {
  // Check cache first
  const cached = cache.get(wallet)
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`Cache hit for wallet ${wallet}`)
    return cached.result
  }

  // Check if already in flight
  if (inFlight.has(wallet)) {
    console.log(`Request already in flight for wallet ${wallet}, waiting...`)
    return inFlight.get(wallet)!
  }

  // Start new request
  const promise = run()
    .then(result => {
      // Cache the result
      cache.set(wallet, { result, timestamp: Date.now() })
      return result
    })
    .finally(() => {
      // Clean up in-flight tracking
      inFlight.delete(wallet)
    })

  inFlight.set(wallet, promise)
  return promise
}

// Clear cache for a specific wallet (useful for testing)
export function clearCache(wallet: string) {
  cache.delete(wallet)
  inFlight.delete(wallet)
}

// Clear all cache
export function clearAllCache() {
  cache.clear()
  inFlight.clear()
}
