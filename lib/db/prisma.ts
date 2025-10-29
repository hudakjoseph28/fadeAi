import { PrismaClient } from '@prisma/client'

// Ensure DATABASE_URL is set before Prisma initializes
// Fallback to default if not in environment (Next.js loads .env.local automatically)
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db'
  console.log('⚠️  DATABASE_URL not found in environment, using default: file:./prisma/dev.db')
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Only log errors and warnings, not queries (too verbose)
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Log connection info in development
if (process.env.NODE_ENV === 'development') {
  console.log(`✅ Prisma Client initialized with DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 30)}...`)
}
