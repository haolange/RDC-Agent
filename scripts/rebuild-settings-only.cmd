@echo off
call "%~dp0run-rdc-launcher.cmd" --mode desktop-dev --rebuild-settings-only %*
exit /b %ERRORLEVEL%
