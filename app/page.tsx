import { WalletForm } from '@/components/WalletForm'

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
          FadeAI
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Analyze your Solana wallet and discover your diamond hands potential. 
          See what you could have made if you held to the top.
        </p>
      </div>
      
      <WalletForm />
      
      <div className="mt-16 text-center">
        <h2 className="text-2xl font-semibold mb-6">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-purple-600 font-bold">1</span>
            </div>
            <h3 className="font-semibold mb-2">Connect Wallet</h3>
            <p className="text-muted-foreground text-sm">
              Enter your Solana wallet address to analyze your trading history
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-blue-600 font-bold">2</span>
            </div>
            <h3 className="font-semibold mb-2">Analyze Trades</h3>
            <p className="text-muted-foreground text-sm">
              We fetch all your SPL token transactions and reconstruct your positions
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-green-600 font-bold">3</span>
            </div>
            <h3 className="font-semibold mb-2">See Potential</h3>
            <p className="text-muted-foreground text-sm">
              Discover your regret gap - what you could have made with diamond hands
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
