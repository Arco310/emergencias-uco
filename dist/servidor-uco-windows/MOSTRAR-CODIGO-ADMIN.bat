@echo off
setlocal
chcp 65001 >nul
title Gestor de Emergencias UCO - Codigo de administracion
rem Muestra el codigo de administracion del servidor. Solo hace falta UNA vez: para activar el
rem servidor central desde la aplicacion (Sistema - Servidor central - Activar).
net session >nul 2>&1
if errorlevel 1 (
  echo Se necesitan permisos de administrador: acepta el aviso de Windows.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "F=%ProgramData%\GestorUCO\datos\_servidor\codigo-admin.txt"
if not exist "%F%" (
  echo No se encuentra el codigo. Comprueba que el servidor esta instalado y en marcha.
  pause
  exit /b 1
)
echo.
echo Codigo de administracion del servidor (no lo compartas; solo se usa para activar el servidor central):
echo.
type "%F%"
echo.
pause
