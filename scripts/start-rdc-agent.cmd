@echo off
setlocal

cd /d "%~dp0\.."

if not exist "package.json" (
  echo [RDC-Agent] 未找到 package.json，请确认脚本位于仓库的 scripts 目录下。
  exit /b 1
)

if not exist "node_modules" (
  echo [RDC-Agent] 未检测到 node_modules，正在先执行 npm install...
  call npm install
  if errorlevel 1 exit /b %ERRORLEVEL%
)

echo [RDC-Agent] 正在启动应用...
call npm run dev
exit /b %ERRORLEVEL%
