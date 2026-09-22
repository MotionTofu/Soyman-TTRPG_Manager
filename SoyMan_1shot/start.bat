@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SoyMan OneShot - локальный запуск

where node >nul 2>nul
if errorlevel 1 (
  echo [ошибка] Node.js не найден. Установите Node.js LTS с https://nodejs.org/
  pause
  exit /b 1
)

if not exist "..\client\node_modules" (
  echo [ошибка] Нет зависимостей в ..\client\node_modules
  echo Выполните один раз:  cd ..\client ^&^& npm install
  pause
  exit /b 1
)

echo Запуск SoyMan OneShot...
echo Сайт откроется в браузере: http://127.0.0.1:4318/
echo Чтобы остановить — нажмите Ctrl+C в этом окне.
echo.
start /min cmd /c "timeout /t 6 >nul & start http://127.0.0.1:4318/ & exit"

npm start
pause
