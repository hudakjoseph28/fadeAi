'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { SummaryCards } from '@/components/SummaryCards'
import { TokenTable } from '@/components/TokenTable'
import { TransactionList } from '@/components/TransactionList'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react'
import { AnalyzeResponse } from '@/app/api/analyze/route'

export default function ResultsPage() {
  const params = useParams()
  const router = useRouter()
  const wallet = params.wallet as string
  
  const [data, setData] = useState<AnalyzeResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalysis = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/analyze?wallet=${encodeURIComponent(wallet)}`)
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to analyze wallet')
      }
      
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    if (wallet) {
      fetchAnalysis()
    }
  }, [wallet, fetchAnalysis])

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Analyzing Wallet</h2>
            <p className="text-muted-foreground">
              Fetching transactions and calculating your diamond hands potential...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <CardTitle className="text-red-600">Analysis Failed</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">{error}</p>
              <div className="flex space-x-2">
                <Button onClick={fetchAnalysis} variant="outline">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
                <Button onClick={() => router.push('/')} variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <Button 
            onClick={() => router.push('/')} 
            variant="outline"
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
          <Button onClick={fetchAnalysis} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
        
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Wallet Analysis</h1>
          <p className="text-muted-foreground">
            <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
              {wallet}
            </span>
          </p>
        </div>
      </div>

      <SummaryCards summary={data.summary} />
      
      {data.transactions && data.transactions.length > 0 && (
        <div className="mb-8">
          <TransactionList 
            transactions={data.transactions} 
            totalTransactions={data.totalTransactions || 0}
          />
        </div>
      )}
      
      <TokenTable data={data} />
    </div>
  )
}
