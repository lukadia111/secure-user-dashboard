@echo off
setlocal
cd /d "%~dp0"

if not exist work mkdir work

echo Running dashboard debug start...
echo Output will be saved to work\dashboard-debug.log
echo.

(
  echo ===== Secure Dashboard Debug Start =====
  echo Date: %date% %time%
  echo Folder: %cd%
  echo.
  echo Node path:
  where node
  echo.
  echo Node version:
  node --version
  echo.
  echo npm version:
  call npm.cmd --version
  echo.
  if not exist node_modules (
    echo Installing dependencies...
    call npm.cmd install
  )
  echo.
  echo Starting server...
  node src\server.js
) > work\dashboard-debug.log 2>&1

type work\dashboard-debug.log
echo.
echo If the site still does not open, send the contents of work\dashboard-debug.log.
pause
