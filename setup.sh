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

