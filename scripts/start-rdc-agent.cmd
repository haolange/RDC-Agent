@echo off
setlocal

cd /d "%~dp0\.."

if not exist "package.json" (
  echo [RDC-Agent] package.json not found. Run this script from the repository scripts directory.
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [RDC-Agent] Electron runtime is missing. Run npm install first.
  exit /b 1
)

if not exist "node_modules\.bin\electron-vite.cmd" (
  echo [RDC-Agent] Build tool is missing. Run npm install first.
  exit /b 1
)

echo [RDC-Agent] Building current application sources...
call "node_modules\.bin\electron-vite.cmd" build
if errorlevel 1 exit /b %ERRORLEVEL%

echo [RDC-Agent] Starting visible Electron React WebUI from build output...
echo [RDC-Agent] The same main process will also print the /app browser session URL.
set "RDC_AGENT_HEADLESS=0"
set "RDC_AGENT_TEST_MODE=0"
set "NODE_ENV=production"
call "node_modules\electron\dist\electron.exe" "out\main\index.js"
exit /b %ERRORLEVEL%
