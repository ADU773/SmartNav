@echo off
rem Stops the servers started by start-demo.bat by closing their windows.
title SmartNav360 - stop demo
for %%W in ("SmartNav Backend" "SmartNav Frontend" "SmartNav Mobile") do (
  taskkill /FI "WINDOWTITLE eq %%~W*" /T /F >nul 2>nul && echo  Stopped %%~W
)
echo  SmartNav360 demo stopped.
timeout /t 3 >nul
