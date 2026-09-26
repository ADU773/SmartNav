@echo off
setlocal EnableExtensions
title SmartNav360 Demo Launcher
cd /d "%~dp0"

rem ======================================================================
rem  SmartNav360 demo launcher
rem
rem    start-demo.bat            start everything and open the app
rem    start-demo.bat check      only check the setup; start nothing
rem    start-demo.bat test       run the test suites first, then start
rem    start-demo.bat mobile     also start the SmartNav Capture phone app (Expo)
rem
rem  Options can be combined, for example:  start-demo.bat test mobile
rem  Stop everything with stop-demo.bat, or close the server windows.
rem ======================================================================

set "RUN_TESTS=0"
set "RUN_MOBILE=0"
set "CHECK_ONLY=0"
for %%A in (%*) do (
  if /i "%%~A"=="test" set "RUN_TESTS=1"
  if /i "%%~A"=="mobile" set "RUN_MOBILE=1"
  if /i "%%~A"=="check" set "CHECK_ONLY=1"
)

echo.
echo  ==============================================
echo    SmartNav360 - demo launcher
echo  ==============================================
echo.

rem ---- 1. Node.js -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed. Install version 20 or newer from https://nodejs.org
  goto :fail
)
for /f "delims=" %%v in ('node -v') do echo  [OK] Node.js %%v

rem ---- 2. Backend configuration ------------------------------------------
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo  [!] Created backend\.env from the template.
  echo      Fill in MONGODB_URI and the two JWT secrets, save, then run this again.
  start "" notepad "backend\.env"
  goto :fail
)
findstr /b /c:"MONGODB_URI=" "backend\.env" >nul
if errorlevel 1 (
  echo  [X] backend\.env has no MONGODB_URI line. Add your MongoDB connection string.
  goto :fail
)
echo  [OK] backend\.env found

rem ---- 3. Packages -------------------------------------------------------
if not exist "backend\node_modules" (
  echo  ... Installing backend packages, this takes a minute the first time
  call npm --prefix backend install --no-audit --no-fund
  if errorlevel 1 goto :fail
)
if not exist "frontend\node_modules" (
  echo  ... Installing frontend packages, this takes a minute the first time
  call npm --prefix frontend install --no-audit --no-fund
  if errorlevel 1 goto :fail
)
if "%RUN_MOBILE%"=="1" if not exist "mobile\node_modules" (
  echo  ... Installing phone app packages
  call npm --prefix mobile install --no-audit --no-fund
  if errorlevel 1 goto :fail
)
echo  [OK] Packages installed

rem ---- 4. "Where am I?" model ------------------------------------------
rem  Downloads once (24 MB), verifies its checksum, then reuses the cache.
call npm --prefix backend run models:fetch --silent >nul 2>nul
if errorlevel 1 (
  echo  [!] Could not download the "Where am I?" model. Everything else works;
  echo      that feature will retry the download on first use.
) else (
  echo  [OK] "Where am I?" model ready
)

rem ---- 5. Network address, so a phone can reach the app -----------------
rem  Picks the connected adapter that has a default gateway, i.e. the Wi-Fi or
rem  Ethernet the phone shares, and ignores VPN and virtual-machine adapters.
set "LANIP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$c = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1; if ($c) { $c.IPv4Address[0].IPAddress }"`) do set "LANIP=%%i"
if defined LANIP (
  set "APP_HOST=%LANIP%"
  echo  [OK] Network address %LANIP% - phones on the same Wi-Fi can connect
) else (
  set "APP_HOST=localhost"
  echo  [!] No network connection found. The desktop demo works; phone capture needs Wi-Fi.
)

rem ---- 6. Ports must be free ---------------------------------------------
set "PORTS_BUSY=0"
netstat -ano | findstr /r /c:":5000 .*LISTENING" >nul && (
  echo  [X] Port 5000 is already in use. Run stop-demo.bat or close the other backend window.
  set "PORTS_BUSY=1"
)
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul && (
  echo  [X] Port 5173 is already in use. Run stop-demo.bat or close the other frontend window.
  set "PORTS_BUSY=1"
)
if "%PORTS_BUSY%"=="0" echo  [OK] Ports 5000 and 5173 are free

if "%CHECK_ONLY%"=="1" (
  echo.
  if "%PORTS_BUSY%"=="1" goto :fail
  echo  Setup looks good. Run start-demo.bat without "check" to start the demo.
  echo.
  pause
  exit /b 0
)
if "%PORTS_BUSY%"=="1" goto :fail

rem ---- 7. Tests, optional -------------------------------------------------
if "%RUN_TESTS%"=="1" (
  echo.
  echo  ... Running backend tests
  call npm --prefix backend test
  if errorlevel 1 (
    echo  [X] Backend tests failed. See the output above.
    goto :fail
  )
  echo  ... Running frontend tests
  call npm --prefix frontend test
  if errorlevel 1 (
    echo  [X] Frontend tests failed. See the output above.
    goto :fail
  )
  echo  [OK] All tests passed
)

rem ---- 8. Backend --------------------------------------------------------
rem  The browser will call the API from the network address, so the backend
rem  must allow that origin. Environment variables take priority over .env.
set "CORS_ORIGINS=http://localhost:5173"
if defined LANIP set "CORS_ORIGINS=http://localhost:5173,http://%LANIP%:5173"

echo.
echo  ... Starting the backend
start "SmartNav Backend" cmd /k npm --prefix backend start

powershell -NoProfile -Command "for ($i = 0; $i -lt 90; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5000/healthz; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 (
  echo  [X] The backend did not become ready within 90 seconds.
  echo      Check the "SmartNav Backend" window. The usual cause is MongoDB Atlas
  echo      Network Access not allowing this computer's IP address.
  goto :fail
)
echo  [OK] Backend running and connected to the database

rem ---- 9. Frontend -------------------------------------------------------
echo  ... Starting the frontend
start "SmartNav Frontend" cmd /k npm --prefix frontend run dev -- --host

powershell -NoProfile -Command "for ($i = 0; $i -lt 90; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5173; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 (
  echo  [X] The frontend did not start within 90 seconds. Check the "SmartNav Frontend" window.
  goto :fail
)
echo  [OK] Frontend running

rem ---- 10. Phone app, optional --------------------------------------------
if "%RUN_MOBILE%"=="1" (
  if defined LANIP set "EXPO_PUBLIC_API_BASE_URL=http://%LANIP%:5000"
  echo  ... Starting the SmartNav Capture phone app - scan its QR code with Expo Go
  start "SmartNav Mobile" cmd /k "cd /d mobile && npx expo start"
)

rem ---- 11. Open the app --------------------------------------------------
start "" "http://%APP_HOST%:5173"

echo.
echo  ==============================================
echo    SmartNav360 is running
echo  ==============================================
echo.
echo   App:             http://%APP_HOST%:5173
echo   Backend health:  http://localhost:5000/healthz
echo.
echo   Suggested demo order:
echo    1. Sign in, or register. The first account becomes the administrator.
echo    2. Assets          - upload panoramas; thumbnails are made automatically
echo    3. Scenes          - create scenes with the image picker preview
echo    4. Hotspots        - click a doorway, pick the destination, add the way back
echo    5. Panoramic Viewer - scan the QR code with a phone, capture, stitch
echo    6. Virtual Experience - walk the tour, "Where am I?", step-free routes
echo    7. Analytics, Floor Plan, AI Workspace, Publish
echo.
echo   If a phone cannot connect: same Wi-Fi as this computer, and allow
echo   Node.js through Windows Firewall on Private networks.
echo.
echo   To stop: run stop-demo.bat, or close the server windows.
echo.
pause
exit /b 0

:fail
echo.
echo  Demo not started. Fix the item marked [X] or [!] above and run this again.
echo.
pause
exit /b 1
