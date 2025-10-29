'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ExternalLink, ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface TransactionListProps {
  transactions: Array<{
    signature: string
    timestamp: number | null
    netUsd: number
    transferCount: number
    topTransfer: {
      mint: string
      amount: number
      usdValue: number
    } | null
  }>
  totalTransactions: number
}

export function TransactionList({ transactions, totalTransactions }: TransactionListProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'N/A'
    return new Date(timestamp * 1000).toLocaleString()
  }

  const formatMint = (mint: string) => {
    if (mint === 'So11111111111111111111111111111111111111112') return 'SOL'
    return `${mint.substring(0, 4)}...${mint.substring(mint.length - 4)}`
  }

  const shortenSignature = (sig: string) => {
    return `${sig.substring(0, 8)}...${sig.substring(sig.length - 8)}`
  }

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No transactions found for this wallet
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Recent Transactions</CardTitle>
          <span className="text-sm text-muted-foreground">
            Showing {Math.min(transactions.length, 100)} of {totalTransactions}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Signature</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="text-right">Net USD</TableHead>
                <TableHead className="text-right">Transfers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.slice(0, 100).map((tx) => (
                <TableRow key={tx.signature}>
                  <TableCell className="text-sm">
                    {formatDate(tx.timestamp)}
                  </TableCell>
                  <TableCell>
                    <a
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:underline font-mono text-xs"
                    >
                      {shortenSignature(tx.signature)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </TableCell>
                  <TableCell>
                    {tx.topTransfer ? (
                      <span className="font-mono text-sm">
                        {formatMint(tx.topTransfer.mint)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {tx.topTransfer ? (
                      <span className="text-sm">
                        {tx.topTransfer.amount > 0 ? '+' : ''}
                        {tx.topTransfer.amount.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className={`flex items-center justify-end gap-1 ${
                      tx.netUsd >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {tx.netUsd >= 0 ? (
                        <ArrowUpRight className="h-4 w-4" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4" />
                      )}
                      <span className="font-semibold">
                        {formatCurrency(Math.abs(tx.netUsd))}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {tx.transferCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

