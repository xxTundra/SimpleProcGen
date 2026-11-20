#!/usr/bin/env bash

cd "$(dirname "$0")" || exit 1

probe() {
  node -e "var h=require('http');var r=h.get({host:'127.0.0.1',port:8923,path:'/api/health',timeout:1500},function(x){var d='';x.on('data',function(c){d=d+c});x.on('end',function(){var ok=false;try{ok=JSON.parse(d).ok===true}catch(e){}process.exit(ok?3:1)});});r.on('error',function(){process.exit(1)});r.on('timeout',function(){r.destroy();process.exit(1)})"
}

open_browser() {
  if [ "$(uname -s)" = "Darwin" ]; then
    open "http://127.0.0.1:8923/" >/dev/null 2>&1
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://127.0.0.1:8923/" >/dev/null 2>&1
  else
    echo "Open http://127.0.0.1:8923/ in your browser."
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js was not found on this machine."
  echo "Install Node.js from https://nodejs.org/ and try again."
  echo
  exit 1
fi

probe
status=$?
if [ "$status" -eq 3 ]; then
  echo "A TTRPG Tools server is already running on port 8923 - not starting another."
  open_browser
  exit 0
fi

echo "Starting TTRPG Tools server on http://127.0.0.1:8923/ ..."
open_browser
printf '\033]0;SimpleProcGen (TTRPG Tools)\007'
exec -a "SimpleProcGen (TTRPG Tools)" node server/server.js
