@echo off
setlocal
chcp 65001 >nul
title Gestor de Emergencias UCO - Instalar servidor
if not exist "%~dp0instalar.mjs" (
  echo Descomprime primero el ZIP completo en una carpeta y ejecuta este archivo desde ella.
  pause
  exit /b 1
)
rem Necesita permisos de administrador (instala programas y crea la tarea de arranque)
net session >nul 2>&1
if errorlevel 1 (
  echo Se necesitan permisos de administrador: acepta el aviso de Windows.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
if exist "%NODE%" if exist "%TS%" goto instalar
where winget >nul 2>&1
if errorlevel 1 (
  echo.
  echo No se encuentra winget. Instala a mano Node.js LTS ^(https://nodejs.org^) y Tailscale ^(https://tailscale.com/download/windows^)
  echo y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
if not exist "%NODE%" (
  echo Instalando Node.js LTS...
  winget install -e --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
)
if not exist "%TS%" (
  echo Instalando Tailscale...
  winget install -e --id Tailscale.Tailscale --source winget --accept-source-agreements --accept-package-agreements
)
:instalar
if not exist "%NODE%" for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
if not exist "%NODE%" (
  echo No se ha podido instalar Node.js. Instalalo desde https://nodejs.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
"%NODE%" "%~dp0instalar.mjs"
echo.
pause
