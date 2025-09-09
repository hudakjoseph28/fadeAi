'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react'
import { AnalyzeResponse } from '@/app/api/analyze/route'

interface TokenTableProps {
  data: AnalyzeResponse
}

export function TokenTable({ data }: TokenTableProps) {
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set())

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  const toggleExpanded = (tokenMint: string) => {
    const newExpanded = new Set(expandedTokens)
    if (newExpanded.has(tokenMint)) {
      newExpanded.delete(tokenMint)
    } else {
      newExpanded.add(tokenMint)
    }
    setExpandedTokens(newExpanded)
  }

  // Sort tokens by regret gap (descending)
  const sortedTokens = [...data.tokens].sort((a, b) => b.regretGapUsd - a.regretGapUsd)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Realized P/L</TableHead>
              <TableHead className="text-right">Peak Potential</TableHead>
              <TableHead className="text-right">Regret Gap</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTokens.map((token) => {
              const isExpanded = expandedTokens.has(token.tokenMint)
              const hasLots = token.lots.length > 0

              return (
                <React.Fragment key={token.tokenMint}>
                  <TableRow>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpanded(token.tokenMint)}
                          disabled={!hasLots}
                          className="h-6 w-6 p-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <div>
                          <div className="font-medium">{token.symbol}</div>
                          <div className="text-xs text-muted-foreground">
                            {token.tokenMint.slice(0, 8)}...{token.tokenMint.slice(-8)}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={token.realizedUsd >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {formatCurrency(token.realizedUsd)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-green-600">
                        {formatCurrency(token.peakPotentialUsd)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-red-600">
                        {formatCurrency(token.regretGapUsd)}
                      </span>
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                  
                  {isExpanded && hasLots && (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        <div className="bg-muted/50 p-4">
                          <h4 className="font-medium mb-3">Lot Details</h4>
                          <div className="space-y-3">
                            {token.lots.map((lot) => (
                              <div key={lot.lotId} className="bg-background p-3 rounded-lg border">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <div className="text-muted-foreground">Buy Date</div>
                                    <div>{formatDate(lot.buyTime)}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Quantity</div>
                                    <div>{lot.buyQty.toLocaleString()}</div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Peak Date</div>
                                    <div>
                                      {lot.peakTimestamp ? formatDate(lot.peakTimestamp) : 'N/A'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Peak Price</div>
                                    <div>
                                      {lot.peakPriceUsd ? formatCurrency(lot.peakPriceUsd) : 'N/A'}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <div className="text-muted-foreground">Realized</div>
                                    <div className={lot.realizedUsd >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {formatCurrency(lot.realizedUsd)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Peak Potential</div>
                                    <div className="text-green-600">
                                      {formatCurrency(lot.peakPotentialUsd)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">Regret Gap</div>
                                    <div className="text-red-600">
                                      {formatCurrency(lot.regretGapUsd)}
                                    </div>
                                  </div>
                                </div>
                                {lot.matchedSells.length > 0 && (
                                  <div className="mt-3">
                                    <div className="text-muted-foreground text-sm mb-2">Sell History</div>
                                    <div className="space-y-1">
                                      {lot.matchedSells.map((sell, index) => (
                                        <div key={index} className="flex justify-between text-xs">
                                          <span>{formatDate(sell.time)}</span>
                                          <span>{sell.qty.toLocaleString()}</span>
                                          {sell.proceedsUsd && (
                                            <span className={sell.proceedsUsd >= 0 ? 'text-green-600' : 'text-red-600'}>
                                              {formatCurrency(sell.proceedsUsd)}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
        
        {data.tokens.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No token activity found for this wallet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
