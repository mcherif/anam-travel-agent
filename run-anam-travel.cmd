@echo off
setlocal
set script_dir=%~dp0
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -File "%script_dir%run-anam-travel.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%script_dir%run-anam-travel.ps1" %*
)
endlocal
