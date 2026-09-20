@echo off
setlocal
cd /d "%~dp0"
call npm.cmd run release:portable
if errorlevel 1 (
  echo No se pudo generar el portable. Revisa el error anterior.
  pause
  exit /b 1
)
echo Portable nuevo generado. Las versiones anteriores se conservaron.
pause
