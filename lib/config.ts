import { z } from 'zod'

const configSchema = z.object({
  HELIUS_API_KEY: z.string().min(1, 'Helius API key is required'),
  SOLSCAN_API_TOKEN: z.string().min(1, 'Solscan API token is required'),
  PRICE_PROVIDER: z.enum(['birdeye', 'dexscreener']).default('dexscreener'),
  BIRDEYE_API_KEY: z.string().optional(),
  DATABASE_URL: z.string().default('file:./dev.db'),
})

// Handle test environment where env vars might not be set
const isTest = process.env.NODE_ENV === 'test'

// Determine price provider based on environment variable
const getPriceProvider = () => {
  const provider = process.env.PRICE_PROVIDER
  if (provider === 'birdeye' || provider === 'dexscreener') {
    return provider
  }
  // If PRICE_PROVIDER looks like an API key, assume it's Birdeye
  if (provider && provider.length > 20) {
    return 'birdeye'
  }
  return 'dexscreener'
}

export const config = configSchema.parse({
  HELIUS_API_KEY: isTest ? 'test-helius-key' : process.env.HELIUS_API_KEY,
  SOLSCAN_API_TOKEN: isTest ? 'test-solscan-token' : process.env.SOLSCAN_API_TOKEN,
  PRICE_PROVIDER: getPriceProvider(),
  BIRDEYE_API_KEY: process.env.PRICE_PROVIDER, // Use PRICE_PROVIDER as Birdeye API key if it looks like one
  DATABASE_URL: process.env.DATABASE_URL,
})

export type Config = z.infer<typeof configSchema>
