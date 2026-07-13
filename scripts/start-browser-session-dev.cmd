@echo off
setlocal
cd /d "%~dp0\.."

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_EXE=node"
) else (
  set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

if not exist "%NODE_EXE%" if "%NODE_EXE%"=="node" goto run
if not exist "%NODE_EXE%" (
  echo [RDC-Agent] Node.js ^>=22.12.0 is missing. Install Node.js or run from a Codex environment with its bundled runtime.
  exit /b 1
)

:run
call "%NODE_EXE%" "%CD%\scripts\launch-rdc-agent.mjs" --mode browser-dev %*
exit /b %ERRORLEVEL%
