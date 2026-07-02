@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Планировщик ресурсов

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [!] Node.js не найден.
  echo     Установите LTS-версию с https://nodejs.org и запустите этот файл снова.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости. Это разово, пара минут...
  call npm install
)

echo.
echo Запускаю приложение. Браузер откроется сам на http://localhost:5173
echo Чтобы остановить — закройте это окно.
echo.

start "" cmd /c "timeout /t 4 >nul & start http://localhost:5173"
call npm run dev
