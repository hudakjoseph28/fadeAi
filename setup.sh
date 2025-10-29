#!/bin/bash

# FadeAI Setup Script
echo "🚀 Setting up FadeAI..."
echo ""
echo "📋 Instructions:"
echo "   1. This script will clean, install dependencies, and start the dev server"
echo "   2. Once the dev server starts, look for a localhost link in the terminal"
echo "   3. Click or copy the localhost link (usually http://localhost:3000) to open FadeAI in your browser"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js v18 or higher."
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Check for .env.local and HELIUS_API_KEY
echo "🔐 Checking environment configuration..."
if [ ! -f ".env.local" ]; then
    echo "⚠️  Warning: .env.local file not found."
    echo "   Creating .env.local from env.example..."
    if [ -f "env.example" ]; then
        cp env.example .env.local
        echo "   Please add your HELIUS_API_KEY to .env.local"
    else
        echo "   env.example not found. Please create .env.local with HELIUS_API_KEY"
    fi
else
    # Check if HELIUS_API_KEY is set (but not if it's the example value)
    if grep -q "HELIUS_API_KEY=" .env.local && ! grep -q "HELIUS_API_KEY=f44999a3" .env.local; then
        echo "✅ .env.local found with HELIUS_API_KEY configured"
    else
        echo "⚠️  Warning: HELIUS_API_KEY not found in .env.local or using example value"
        echo "   Please add your HELIUS_API_KEY to .env.local before running the app"
        echo "   Get your API key from: https://www.helius.dev/"
    fi
    
    # Ensure DATABASE_URL is set in .env.local
    if ! grep -q "DATABASE_URL=" .env.local; then
        echo "   Adding DATABASE_URL to .env.local..."
        echo 'DATABASE_URL="file:./prisma/dev.db"' >> .env.local
        echo "✅ DATABASE_URL added to .env.local"
    else
        echo "✅ DATABASE_URL found in .env.local"
    fi
fi

# Clean up existing installations
echo "🧹 Cleaning up existing installations..."
if [ -d "node_modules" ]; then
    echo "   Removing node_modules..."
    rm -rf node_modules
fi

if [ -f "package-lock.json" ]; then
    echo "   Removing package-lock.json..."
    rm -f package-lock.json
fi

echo "   Cleaning npm cache..."
npm cache clean --force

echo "✅ Cleanup complete!"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully!"
    echo ""
    
    # Initialize Prisma database
    echo "🗄️  Initializing Prisma database..."
    echo "   Generating Prisma Client..."
    npx prisma generate
    
    if [ $? -eq 0 ]; then
        echo "   ✅ Prisma Client generated"
        echo "   Pushing database schema..."
        npx prisma db push --accept-data-loss
        
        if [ $? -eq 0 ]; then
            echo "   ✅ Database schema synced"
        else
            echo "   ⚠️  Database push had issues, but continuing..."
        fi
    else
        echo "   ⚠️  Prisma generate had issues, but continuing..."
    fi
    
    echo ""
    echo "🎉 Setup complete! Starting development server..."
    echo ""
    echo "📱 IMPORTANT: Once the server starts, look for the localhost link below"
    echo "   (usually http://localhost:3000) and click it to open FadeAI in your browser"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    # Start the dev server
    npm run dev
else
    echo "❌ Failed to install dependencies. Please check the error messages above."
    exit 1
fi

