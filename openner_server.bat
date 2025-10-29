@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Change to the directory of this script
pushd "%~dp0"

REM Check Node and NPM availability
where node >nul 2>nul || goto nonode
where npm  >nul 2>nul || goto nonpm

pushd "server"
if exist package.json (
  REM Install dependencies if missing
  if not exist node_modules (
    echo Installing server dependencies...
    call npm install
  )

  echo Starting LLM proxy server on http://localhost:8787 ...
  start "i2graph_llm_proxy" cmd /k "npm run start:llm"

  echo Starting DB API server on http://localhost:8788 ...
  start "i2graph_db_api" cmd /k "npm run start:db"

  REM Give the servers a moment to boot, then open health endpoints
  timeout /t 3 >nul
  start "" http://localhost:8787/api/health
  start "" http://localhost:8788/db/health
) else (
  echo Error: server\package.json not found. Check the server folder.
  pause
)
popd
goto end

:nonode
echo Node not found. Please install Node.js (v18+) and ensure it's on PATH.
pause
goto end

:nonpm
echo NPM not found. Please ensure Node.js added NPM to PATH.
pause
goto end

:end
popd
endlocal

