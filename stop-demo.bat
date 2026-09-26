@echo off
rem Stops the SmartNav360 demo started by start-demo.bat.
rem
rem It finds whatever is listening on the demo ports (backend 5000, frontend
rem 5173, Expo 8081) and ends it. The console window around each server is
rem closed too, but only if start-demo.bat opened it; a terminal you started
rem yourself is left alone.
title SmartNav360 - stop demo
powershell -NoProfile -Command ^
  "$stopped = 0;" ^
  "foreach ($port in 5000, 5173, 8081) {" ^
  "  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "  foreach ($id in $owners) {" ^
  "    $target = $id; $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id);" ^
  "    while ($proc -and $proc.ParentProcessId) {" ^
  "      $parent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $proc.ParentProcessId);" ^
  "      if (-not $parent) { break }" ^
  "      if ($parent.Name -eq 'cmd.exe') {" ^
  "        if ($parent.CommandLine -match 'npm --prefix (backend|frontend)|expo start') { $target = $parent.ProcessId; break }" ^
  "        if ($parent.CommandLine -notmatch ' /c ') { break }" ^
  "        $target = $parent.ProcessId; $proc = $parent; continue" ^
  "      }" ^
  "      if ($parent.Name -ne 'node.exe') { break }" ^
  "      $target = $parent.ProcessId; $proc = $parent" ^
  "    }" ^
  "    taskkill /PID $target /T /F | Out-Null; $stopped++; Write-Host (' Stopped the server on port ' + $port)" ^
  "  }" ^
  "};" ^
  "if ($stopped -eq 0) { Write-Host ' Nothing was running on the demo ports.' } else { Write-Host ' SmartNav360 demo stopped.' }"
ping -n 3 127.0.0.1 >nul
