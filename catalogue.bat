@echo off
setlocal
python -B -X utf8 "%~dp0scripts\catalogue.py" %*
set "result=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %result%
