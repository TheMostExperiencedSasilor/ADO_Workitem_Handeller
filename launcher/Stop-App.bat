@echo off
setlocal
pushd "%~dp0.." >nul 2>&1
if errorlevel 1 exit /b 1

if exist "backend\.venv\Scripts\python.exe" (
  "backend\.venv\Scripts\python.exe" start_app.py --stop
  set "APP_EXIT=%ERRORLEVEL%"
  popd
  exit /b %APP_EXIT%
)

py -3 start_app.py --stop >nul 2>&1
set "APP_EXIT=%ERRORLEVEL%"
popd
exit /b %APP_EXIT%
