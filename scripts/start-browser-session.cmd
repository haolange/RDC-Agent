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

echo [RDC-Agent] Starting headless main process for Codex in-app browser verification...
if "%RDC_AGENT_USER_DATA%"=="" (
  echo [RDC-Agent] Using default app profile under %%APPDATA%%\rdc-agent.
) else (
  echo [RDC-Agent] Using explicit RDC_AGENT_USER_DATA=%RDC_AGENT_USER_DATA%
  if not exist "%RDC_AGENT_USER_DATA%" mkdir "%RDC_AGENT_USER_DATA%"
)
set "RDC_AGENT_HEADLESS=1"
if "%NODE_ENV%"=="" set "NODE_ENV=production"
call "node_modules\electron\dist\electron.exe" "out\main\index.js"
exit /b %ERRORLEVEL%
