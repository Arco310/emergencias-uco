@echo off
setlocal
chcp 65001 >nul
title Gestor de Emergencias UCO - Desinstalar servidor
net session >nul 2>&1
if errorlevel 1 (
  echo Se necesitan permisos de administrador: acepta el aviso de Windows.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo Se detendra el servidor y se quitara su arranque automatico. Los datos se conservan.
choice /C SN /M "Continuar"
if errorlevel 2 exit /b
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
"%NODE%" "%~dp0desinstalar.mjs"
echo.
pause
