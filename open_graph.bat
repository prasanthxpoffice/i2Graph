@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Change to the directory of this script
pushd "%~dp0"

set PORT=5500
echo Attempting to start a local server on port %PORT%...

REM Prefer Python launcher (py) if available
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  start "py_http_server" py -m http.server %PORT%
  timeout /t 2 >nul
  start "" http://localhost:%PORT%/graph/Index.html
  echo Opened http://localhost:%PORT%/graph/Index.html
  goto :end
)

REM Fallback to python.exe if available
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  start "python_http_server" python -m http.server %PORT%
  timeout /t 2 >nul
  start "" http://localhost:%PORT%/graph/Index.html
  echo Opened http://localhost:%PORT%/graph/Index.html
  goto :end
)

REM Final fallback: open the file directly (may block fetch in some browsers)
echo Python not found. Opening local file directly.
echo If data does not load, install Python and rerun this script.
start "" "%~dp0Index.html"

:end
popd
endlocal

