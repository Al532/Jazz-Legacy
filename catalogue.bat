@echo off
setlocal
python -B -X utf8 "%~dp0scripts\catalogue.py" %*
exit /b %ERRORLEVEL%
