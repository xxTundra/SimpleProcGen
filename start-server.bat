@echo off
setlocal
title TTRPG Tools launcher

REM ============================================================
REM  TTRPG Tools launcher - starts the Node.js dev server.
REM
REM  - Requires Node.js on PATH (built-ins only, no npm packages).
REM  - Refuses to start a second server if a healthy one is
REM    already listening on 127.0.0.1:8923.
REM  - Opens the browser at http://127.0.0.1:8923/ .
REM ============================================================

REM --- Node.js must be available on PATH -----------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on this machine.
  echo Install Node.js from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

REM --- Already-running check ------------------------------------------------
REM The probe below exits 3 when a healthy TTRPG server answers /api/health
REM with ok:true on port 8923, and 1 in every other case.
node -e "var h=require('http');var r=h.get({host:'127.0.0.1',port:8923,path:'/api/health',timeout:1500},function(x){var d='';x.on('data',function(c){d=d+c});x.on('end',function(){var ok=false;try{ok=JSON.parse(d).ok===true}catch(e){}process.exit(ok?3:1)});});r.on('error',function(){process.exit(1)});r.on('timeout',function(){r.destroy();process.exit(1)})"
if errorlevel 3 (
  echo A TTRPG Tools server is already running on port 8923 - not starting another.
  start "" "http://127.0.0.1:8923/"
  exit /b 0
)

REM --- Start the Node server in its own titled window -----------------------
echo Starting TTRPG Tools server on http://127.0.0.1:8923/ ...
start "TTRPG Tools server" node "%~dp0server\server.js"

REM --- Poll /api/health until healthy, ~30 x 500 ms --------------------------
set /a tries=0
:poll
set /a tries+=1
node -e "var h=require('http');var r=h.get({host:'127.0.0.1',port:8923,path:'/api/health',timeout:1500},function(x){var d='';x.on('data',function(c){d=d+c});x.on('end',function(){var ok=false;try{ok=JSON.parse(d).ok===true}catch(e){}process.exit(ok?3:1)});});r.on('error',function(){process.exit(1)});r.on('timeout',function(){r.destroy();process.exit(1)})"
if errorlevel 3 goto up
if %tries% geq 30 goto fail
node -e "setTimeout(function(){},500)"
goto poll

:up
echo Server is up: http://127.0.0.1:8923/
start "" "http://127.0.0.1:8923/"
exit /b 0

:fail
echo.
echo The server did not come up in time.
echo Check the "TTRPG Tools server" window for the error, for example
echo port 8923 already in use, and try again.
echo.
pause
exit /b 1
