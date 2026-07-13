@echo off
call "%~dp0run-rdc-launcher.cmd" --mode desktop-dev %*
exit /b %ERRORLEVEL%
