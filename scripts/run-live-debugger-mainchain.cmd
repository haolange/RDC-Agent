@echo off
setlocal
set RDC_AGENT_LIVE_E2E=1
npx playwright test e2e/live-debugger-mainchain.spec.ts --config playwright.config.ts
exit /b %ERRORLEVEL%
