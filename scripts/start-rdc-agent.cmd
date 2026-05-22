@echo off
setlocal

cd /d "%~dp0\.."

if not exist "package.json" (
  echo [RDC-Agent] package.json not found. Run this script from the repository scripts directory.
  exit /b 1
)

echo [RDC-Agent] Synchronizing dependencies...
call npm install
if errorlevel 1 exit /b %ERRORLEVEL%

if not exist "node_modules\electron\dist\electron.exe" (
  echo [RDC-Agent] Installing Electron runtime...
  call node node_modules\electron\install.js
  if errorlevel 1 exit /b %ERRORLEVEL%
)

echo [RDC-Agent] Starting app...
call npm run dev
exit /b %ERRORLEVEL%
