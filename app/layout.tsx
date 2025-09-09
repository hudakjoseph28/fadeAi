import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'FadeAI - Solana Wallet Analyzer',
  description: 'Analyze your Solana wallet and discover your "diamond hands" potential - see what you could have made if you held to the top.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
          {children}
        </div>
      </body>
    </html>
  )
}

