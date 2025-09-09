'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Wallet, Search } from 'lucide-react'
import { isValidSolanaAddress } from '@/lib/validation/wallet'

type Status = "idle" | "typing" | "valid" | "invalid" | "checking" | "done";

export function WalletForm() {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // fully controlled — replace value; don't append
    const next = e.target.value.replace(/\s+/g, "").trim()
    setValue(next)
    setError(null)
    setStatus("typing")
  }, [])

  const handleBlur = useCallback(() => {
    if (!value) {
      setStatus("idle")
      setError(null)
      return
    }
    if (isValidSolanaAddress(value)) {
      setStatus("valid")
      setError(null)
    } else {
      setStatus("invalid")
      setError("Invalid Solana wallet address")
    }
  }, [value])

  const canSubmit = useMemo(
    () => value.length > 0 && (status === "valid" || status === "idle" || status === "typing"),
    [value, status]
  )

  const analyze = useCallback(async () => {
    // final validation at submit
    if (!isValidSolanaAddress(value)) {
      setStatus("invalid")
      setError("Invalid Solana wallet address")
      return
    }
    setStatus("checking")
    setError(null)
    try {
      const res = await fetch(`/api/analyze?wallet=${encodeURIComponent(value)}`)
      if (!res.ok) {
        // surface server-side validation / decode body
        const body = await res.json().catch(() => ({}))
        const msg = body?.message || body?.error || "Analysis failed"
        setStatus("invalid")
        setError(typeof msg === "string" ? msg : "Invalid Solana wallet address")
        return
      }
      setStatus("done")
      // navigate to results page
      router.push(`/results/${encodeURIComponent(value)}`)
    } catch (e) {
      setStatus("invalid")
      setError("Network error. Please try again.")
    }
  }, [value, router])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    await analyze()
  }, [analyze])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      analyze()
    }
  }, [analyze])

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full">
            <Wallet className="h-8 w-8 text-white" />
          </div>
        </div>
        <CardTitle className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          FadeAI
        </CardTitle>
        <CardDescription className="text-lg">
          Discover your diamond hands potential. See what you could have made if you held to the top.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="wallet" className="text-sm font-medium">
              Solana Wallet Address
            </label>
            <Input
              id="wallet"
              type="text"
              placeholder="Paste your address (e.g., BZ1CMB...NcXtL)"
              value={value}
              onChange={handleChange}
              onBlur={handleBlur}
              onKeyDown={onKeyDown}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              className={`text-sm ${status === "invalid" ? "border-red-500" : ""}`}
            />
            {status === "checking" && (
              <p className="text-sm text-gray-500">Checking…</p>
            )}
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>
          <Button 
            type="submit" 
            className="w-full" 
            size="lg"
            disabled={!canSubmit || status === "checking"}
          >
            {status === "checking" ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Analyzing…
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Analyze Wallet
              </>
            )}
          </Button>
        </form>
        
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Try with a sample wallet:</strong>{' '}
            <button
              type="button"
              onClick={() => {
                // set directly; do NOT append to existing text
                const sample = "7YttLkHDoNj9wyDur5pM1ejNaAvT9X4egaYcHQqkDxV"
                setValue(sample)
                setStatus("valid")
                setError(null)
              }}
              className="underline hover:no-underline"
            >
              7YttLkHDoNj9wyDur5pM1ejNaAvT9X4egaYcHQqkDxV
            </button>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
