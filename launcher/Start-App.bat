@echo off
setlocal
pushd "%~dp0.." >nul 2>&1
if errorlevel 1 exit /b 1

if exist "backend\.venv\Scripts\python.exe" (
  "backend\.venv\Scripts\python.exe" start_app.py
  set "APP_EXIT=%ERRORLEVEL%"
  popd
  exit /b %APP_EXIT%
)

py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
  py -3 start_app.py
  set "APP_EXIT=%ERRORLEVEL%"
  popd
  exit /b %APP_EXIT%
)

python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
  python start_app.py
  set "APP_EXIT=%ERRORLEVEL%"
  popd
  exit /b %APP_EXIT%
)

popd
exit /b 1
