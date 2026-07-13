@echo off
call "%~dp0run-rdc-launcher.cmd" --mode browser %*
exit /b %ERRORLEVEL%
