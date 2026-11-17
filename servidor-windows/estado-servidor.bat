@echo off
setlocal
chcp 65001 >nul
title Gestor de Emergencias UCO - Estado del servidor
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
if not exist "%NODE%" (
  echo Node.js no esta instalado: ejecuta primero instalar-servidor.bat
  pause
  exit /b 1
)
"%NODE%" "%~dp0estado.mjs"
echo.
pause
