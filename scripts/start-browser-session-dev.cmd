@echo off
call "%~dp0run-rdc-launcher.cmd" --mode browser-dev %*
exit /b %ERRORLEVEL%
