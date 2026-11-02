@echo off
setlocal
title Internship Desk
cd /d "%~dp0..\.."
echo Starting Internship Desk. Please wait while both local servers are checked...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js or add it to PATH, then run this launcher again.
  pause
  exit /b 1
)
node "%~dp0launch.mjs" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Read the error above before closing this window.
  pause
  exit /b 1
)
echo.
echo Both servers are running in the background.
echo Closing this window or the browser does not stop them.
echo Run this file again after restarting Windows or if the app will not load.
if /i "%~1"=="--no-open" exit /b 0
echo.
echo Press any key to close this launcher window.
pause >nul
exit /b 0
