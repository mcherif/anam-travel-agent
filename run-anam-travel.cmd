@echo off
setlocal
set script_dir=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%script_dir%run-anam-travel.ps1" %*
endlocal
