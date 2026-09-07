@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 goto location_error
if exist "backend\.venv\Scripts\python.exe" (
  "backend\.venv\Scripts\python.exe" start_app.py
  goto finished
)
py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
  py -3 start_app.py
  goto finished
)
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if not errorlevel 1 (
  python start_app.py
  goto finished
)
echo Python 3.10 or newer is required.
echo Install Python from https://www.python.org/downloads/windows/
echo Enable "Add python.exe to PATH", then double-click this file again.
popd
pause
exit /b 1
:finished
set "APP_EXIT=%ERRORLEVEL%"
popd
if not "%APP_EXIT%"=="0" (
  echo.
  echo Setup or startup failed. Review the message above and try again.
  pause
)
exit /b %APP_EXIT%
:location_error
echo Could not open the application folder.
pause
exit /b 1
