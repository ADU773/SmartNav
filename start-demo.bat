@echo off
setlocal EnableExtensions
title SmartNav360 Demo Launcher
cd /d "%~dp0"

rem ======================================================================
rem  SmartNav360 demo launcher
rem
rem    start-demo.bat            start everything, including the SmartNav
rem                              Capture phone app (Expo Go), and open the app
rem    start-demo.bat check      only check the setup; start nothing
rem    start-demo.bat test       run the test suites first, then start
rem    start-demo.bat nomobile   do not start the phone app
rem
rem  Options can be combined, for example:  start-demo.bat test nomobile
rem  Stop everything with stop-demo.bat, or close the server windows.
rem ======================================================================

set "RUN_TESTS=0"
set "RUN_MOBILE=1"
set "CHECK_ONLY=0"
for %%A in (%*) do (
  if /i "%%~A"=="test" set "RUN_TESTS=1"
  if /i "%%~A"=="mobile" set "RUN_MOBILE=1"
  if /i "%%~A"=="nomobile" set "RUN_MOBILE=0"
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
rem  The AI Workspace chat uses OpenAI or Gemini unless LLM_PROVIDER=local.
findstr /r /b /c:"LLM_PROVIDER=local" "backend\.env" >nul
if errorlevel 1 (
  findstr /r /b /c:"OPENAI_API_KEY=." /c:"GEMINI_API_KEY=." "backend\.env" >nul
  if errorlevel 1 (
    echo  [!] backend\.env has no OPENAI_API_KEY or GEMINI_API_KEY, so AI Workspace
    echo      chat will not answer. Everything else works.
  ) else (
    echo  [OK] API key found for AI Workspace chat
  )
)

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

rem ---- 4. AI models ----------------------------------------------------
rem  Downloaded once, checksum-verified, then reused from the cache. The
rem  first run also times the CPU and each GPU and remembers the fastest
rem  (override with ONNX_DEVICE in backend\.env).
set "MODEL_LOG=%TEMP%\smartnav-models.log"
call npm --prefix backend run models:fetch --silent >"%MODEL_LOG%" 2>&1
if errorlevel 1 (
  echo  [!] Could not download the AI models. Everything else works;
  echo      the AI features retry the download on first use.
) else (
  echo  [OK] AI models ready
  for /f "usebackq delims=" %%l in (`findstr /c:" runs on: " "%MODEL_LOG%"`) do echo       %%l
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
if "%RUN_MOBILE%"=="1" (
  netstat -ano | findstr /r /c:":8081 .*LISTENING" >nul && (
    echo  [X] Port 8081 is already in use. Run stop-demo.bat or close the other Expo window.
    set "PORTS_BUSY=1"
  )
)
if "%PORTS_BUSY%"=="0" (
  if "%RUN_MOBILE%"=="1" (echo  [OK] Ports 5000, 5173 and 8081 are free) else (echo  [OK] Ports 5000 and 5173 are free)
)

rem ---- 6b. Phone app checks ------------------------------------------------
rem  Expo Go on the phone must support this project's Expo SDK, and Windows
rem  Firewall must let the phone reach Node.js on this network. Only checked;
rem  firewall settings are never changed by this script.
if "%RUN_MOBILE%"=="1" (
  for /f "delims=" %%v in ('node -p "require('./mobile/node_modules/expo/package.json').version.split('.')[0]"') do set "EXPO_SDK=%%v"
  if not defined LANIP (
    echo  [!] No network connection, so the phone app will not be started.
    set "RUN_MOBILE=0"
  )
)
if "%RUN_MOBILE%"=="1" (
  echo  [OK] Phone app uses Expo SDK %EXPO_SDK% - Expo Go on the phone must support SDK %EXPO_SDK%
  powershell -NoProfile -Command "$cfg = Get-NetIPAddress -IPAddress '%LANIP%' -ErrorAction SilentlyContinue | Get-NetConnectionProfile -ErrorAction SilentlyContinue; $cat = if ($cfg) { [string]$cfg.NetworkCategory } else { 'Public' }; $node = (Get-Command node).Source; $rules = Get-NetFirewallApplicationFilter -Program $node -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and ([string]$_.Profile -match ('Any|' + $cat)) }; if ($rules) { exit 0 } else { Write-Host ('      This Wi-Fi is a ' + $cat + ' network.'); exit 1 }"
  if errorlevel 1 (
    echo  [!] Windows Firewall may block phones from reaching Node.js on this network.
    echo      If Windows asks when the servers start, tick this network type and allow it.
  ) else (
    echo  [OK] Windows Firewall allows Node.js on this network
  )
)

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
rem  With LLM_PROVIDER=local, load the chat model at startup and keep it
rem  loaded, so the first question is answered at once. Ignored for Gemini.
set "CHAT_PRELOAD=true"

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

rem ---- 8b. Chat --------------------------------------------------------
rem  Gemini needs nothing loaded. A local model (LLM_PROVIDER=local) loads in
rem  the background; /healthz reports its state.
powershell -NoProfile -Command "for ($i = 0; $i -lt 180; $i++) { try { $s = (Invoke-RestMethod -TimeoutSec 2 http://localhost:5000/healthz).chatModel; if ($s -eq 'loaded') { exit 0 }; if ($s -eq 'not loaded') { exit 2 }; if ($s -eq 'not used') { exit 3 } } catch {} ; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 3 (
  echo  [OK] AI Workspace chat uses the OpenAI / Gemini API
) else if errorlevel 2 (
  echo  [!] The local chat model did not load. The rest of the demo works; see the
  echo      "SmartNav Backend" window. AI Workspace answers once it is available.
) else if errorlevel 1 (
  echo  [!] The local chat model is still loading. The first reply may be slow.
) else (
  echo  [OK] Local chat model loaded
)

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
rem  Expo is pinned to this computer's network address and port 8081, so the
rem  QR code printed below (by this window, not Expo) always matches it.
if "%RUN_MOBILE%"=="1" (
  set "EXPO_PUBLIC_API_BASE_URL=http://%LANIP%:5000"
  set "REACT_NATIVE_PACKAGER_HOSTNAME=%LANIP%"
  echo  ... Starting the SmartNav Capture phone app ^(Expo^)
  start "SmartNav Mobile" cmd /k "cd /d mobile && npx expo start --lan --port 8081"
)
if "%RUN_MOBILE%"=="1" (
  powershell -NoProfile -Command "for ($i = 0; $i -lt 90; $i++) { try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:8081/status).RawContent -match 'packager-status:running') { exit 0 } } catch {} ; Start-Sleep -Seconds 1 }; exit 1"
  if errorlevel 1 (
    echo  [!] Expo did not start within 90 seconds. Check the "SmartNav Mobile" window.
    set "RUN_MOBILE=0"
  ) else (
    echo  [OK] Expo running at exp://%LANIP%:8081
  )
)
rem  Build the app bundle now, so Expo Go does not wait (or time out) for it
rem  on the first scan. Done in the background; the phone can scan meanwhile.
if "%RUN_MOBILE%"=="1" (
  echo  ... Building the phone app bundle in the background
  start "" /min powershell -NoProfile -WindowStyle Hidden -Command "foreach ($p in 'android', 'ios') { try { $m = Invoke-RestMethod -TimeoutSec 60 -Headers @{ 'expo-platform' = $p; 'Accept' = 'application/expo+json,application/json' } http://localhost:8081; Invoke-WebRequest -UseBasicParsing -TimeoutSec 600 $m.launchAsset.url | Out-Null } catch {} }"
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
echo   Node.js through Windows Firewall for this network type.
echo.
echo   AI Workspace chat uses the OpenAI or Gemini API ^(keys in backend\.env^).
echo   To stop: run stop-demo.bat, or close the server windows.
echo.
if "%RUN_MOBILE%"=="1" (
  echo   SmartNav Capture phone app
  echo    1. Install Expo Go on the phone ^(it must support Expo SDK %EXPO_SDK%^).
  echo    2. Join the same Wi-Fi as this computer.
  echo    3. Scan the QR code below: Expo Go on Android, the Camera app on iPhone.
  echo    4. In the app, scan the session QR code from Panoramic Viewer to capture.
  echo   The first load can take a minute while the bundle finishes building.
  echo.
  node backend\scripts\showExpoQr.js %LANIP% 8081
  echo.
)
pause
exit /b 0

:fail
echo.
echo  Demo not started. Fix the item marked [X] or [!] above and run this again.
echo.
pause
exit /b 1
