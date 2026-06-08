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

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
  where node >nul 2>nul
  if errorlevel 1 (
    echo [RDC-Agent] Node.js runtime is missing. Install Node.js or use the Codex bundled runtime.
    exit /b 1
  )
)

echo [RDC-Agent] Starting headless browser session in development mode...
set "RDC_AGENT_HEADLESS=1"
if "%NODE_ENV%"=="" set "NODE_ENV=development"

echo [RDC-Agent] Building main and preload outputs...
call "%NODE_EXE%" "node_modules\electron-vite\bin\electron-vite.js" build
if errorlevel 1 exit /b %ERRORLEVEL%

echo [RDC-Agent] Starting renderer dev server at http://127.0.0.1:5173/...
start "RDC-Agent renderer dev server" /b cmd /d /c ""%NODE_EXE%" "node_modules\vite\bin\vite.js" --config vite.renderer.config.ts"

powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($i = 0; $i -lt 40; $i++) { try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 1; if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { exit 0 } } catch { Start-Sleep -Milliseconds 250 } }; exit 1"
if errorlevel 1 (
  echo [RDC-Agent] Renderer dev server did not become reachable at http://127.0.0.1:5173/.
  exit /b 1
)

set "ELECTRON_RENDERER_URL=http://127.0.0.1:5173"
call "node_modules\electron\dist\electron.exe" "out\main\index.js"
exit /b %ERRORLEVEL%
