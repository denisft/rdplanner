@echo off
REM Деплой resource-planner на Vercel (production)
REM Запуск: дважды кликнуть по файлу или выполнить deploy.bat в терминале
cd /d "%~dp0"
echo === Деплой на Vercel (production) ===
call npx vercel --prod
echo.
echo === Готово ===
pause
