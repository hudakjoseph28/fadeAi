@echo off
REM FadeAI Setup Script for Windows

echo 🚀 Setting up FadeAI...
echo.
echo 📋 Instructions:
echo    1. This script will clean, install dependencies, and start the dev server
echo    2. Once the dev server starts, look for a localhost link in the terminal
echo    3. Click or copy the localhost link (usually http://localhost:3000) to open FadeAI in your browser
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js v18 or higher.
    exit /b 1
)

REM Check Node.js version
for /f "tokens=1 delims=v" %%i in ('node -v') do set NODE_VERSION=%%i
for /f "tokens=1 delims=." %%i in ("%NODE_VERSION%") do set MAJOR_VERSION=%%i

if %MAJOR_VERSION% lss 18 (
    echo ❌ Node.js version %NODE_VERSION% is too old. Please install Node.js v18 or higher.
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo ✅ Node.js %%i detected

REM Clean up existing installations
echo 🧹 Cleaning up existing installations...
if exist node_modules (
    echo    Removing node_modules...
    rd /s /q node_modules
)

if exist package-lock.json (
    echo    Removing package-lock.json...
    del /f /q package-lock.json
)

echo    Cleaning npm cache...
call npm cache clean --force

echo ✅ Cleanup complete!

REM Install dependencies
echo 📦 Installing dependencies...
call npm install

if %errorlevel% equ 0 (
    echo ✅ Dependencies installed successfully!
    echo.
    echo 🎉 Setup complete! Starting development server...
    echo.
    echo 📱 IMPORTANT: Once the server starts, look for the localhost link below
    echo    (usually http://localhost:3000) and click it to open FadeAI in your browser
    echo.
    echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    echo.
    REM Start the dev server
    call npm run dev
) else (
    echo ❌ Failed to install dependencies. Please check the error messages above.
    exit /b 1
)

