@echo off
setlocal

cd /d "%~dp0\.."

if not exist "package.json" (
  echo [RDC-Agent] package.json not found. Run this script from the repository scripts directory.
  exit /b 1
)

if not exist "node_modules\.bin\electron-vite.cmd" (
  echo [RDC-Agent] Development dependencies are missing. Run npm install first.
  exit /b 1
)

echo [RDC-Agent] Starting visible Electron React WebUI in development mode...
set "RDC_AGENT_HEADLESS=0"
set "RDC_AGENT_TEST_MODE=0"
call "node_modules\.bin\electron-vite.cmd" dev
exit /b %ERRORLEVEL%
