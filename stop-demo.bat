@echo off
setlocal EnableExtensions
rem Match only service consoles launched from this checkout, including workers
rem before they bind a port. Never terminate a process merely for using a port.
set "SMARTNAV_LAUNCHER=%~dp0start-demo.bat"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $pattern='(?i)(?:^|\s)/d\s+/s\s+/c\s+\x22\x22'+[regex]::Escape($env:SMARTNAV_LAUNCHER)+'\x22\s+--(backend|frontend|mobile)\x22$'; $found=0; foreach ($p in (Get-CimInstance Win32_Process -Filter 'Name=''cmd.exe''')) { if ($p.CommandLine -match $pattern) { $name=$Matches[1]; taskkill /PID $p.ProcessId /T /F; if ($LASTEXITCODE -ne 0) { exit 1 }; Write-Host ('Stopped demo '+$name); $found++ } }; if (-not $found) { Write-Host 'No services started by this launcher are running.' }"
exit /b %errorlevel%
