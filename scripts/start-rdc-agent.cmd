@echo off
call "%~dp0run-rdc-launcher.cmd" --mode desktop %*
exit /b %ERRORLEVEL%
