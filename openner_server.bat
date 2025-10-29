@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Change to the directory of this script
pushd "%~dp0"

REM Start the LLM proxy server (Node/Express)
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Starting LLM proxy server on http://localhost:8787 ...
  pushd "server"
  if exist package.json (
    start "i2graph_llm_proxy" cmd /c "npm start"
    REM Give the server a moment to boot, then open health endpoint
    timeout /t 2 >nul
    start "" http://localhost:8787/api/health
  ) else (
    echo Warning: server\package.json not found. Run npm init or check the server folder.
  )
  popd
) else (
  echo Node not found. Please install Node.js (v18+) to run the proxy.
)

popd
endlocal

