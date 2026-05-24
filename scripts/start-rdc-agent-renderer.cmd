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

echo [RDC-Agent] Starting renderer-only Browser Preview server...
call npm run dev:renderer
exit /b %ERRORLEVEL%
