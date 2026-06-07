@echo off
setlocal

cd /d "%~dp0\.."

if not exist "package.json" (
  echo [RDC-Agent] package.json not found. Run this script from the repository scripts directory.
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [RDC-Agent] Electron runtime is missing. Installing dependencies once...
  call npm install
  if errorlevel 1 exit /b %ERRORLEVEL%
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [RDC-Agent] Installing Electron runtime...
  call node node_modules\electron\install.js
  if errorlevel 1 exit /b %ERRORLEVEL%
)

if not exist "out\main\index.js" (
  echo [RDC-Agent] Build output is missing. Building the application...
  call npm run build
  if errorlevel 1 exit /b %ERRORLEVEL%
)

if not exist "out\renderer\index.html" (
  echo [RDC-Agent] Renderer build output is missing. Building the application...
  call npm run build
  if errorlevel 1 exit /b %ERRORLEVEL%
)

echo [RDC-Agent] Starting app...
echo [RDC-Agent] Browser app session URL will be printed by the main process as /app.
call "node_modules\electron\dist\electron.exe" "out\main\index.js"
exit /b %ERRORLEVEL%
