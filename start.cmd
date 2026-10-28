@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required. Please install Node.js 24 and try again.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Dependencies are missing. Run: npm ci
  pause
  exit /b 1
)
if not exist "dist\server\server\index.js" (
  echo Build is missing. Run: npm run build
  pause
  exit /b 1
)
node.exe "dist\server\server\index.js" %*
if errorlevel 1 (
  pause
  exit /b 1
)
