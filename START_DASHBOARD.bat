@echo off
setlocal
cd /d "%~dp0"

echo Starting Secure User Dashboard...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 or newer, then run this file again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set NODE_MAJOR=%%A
if %NODE_MAJOR% LSS 24 (
  echo Your Node.js version is:
  node --version
  echo.
  echo This project needs Node.js 24 or newer because it uses the built-in SQLite driver.
  echo Install the current Node.js version from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Server will run at http://localhost:3000
echo Keep this window open while using the site.
echo Press Ctrl+C to stop the server.
echo.

node src\server.js

echo.
echo The server stopped.
pause
