@echo off
echo Запуск RPG Manager...

start "RPG Manager - Server" cmd /k "cd /d %~dp0server && npm run dev"
start "RPG Manager - Client" cmd /k "cd /d %~dp0client && npm run dev"

echo Ждём запуска серверов...
timeout /t 4 >nul

start http://localhost:5173

echo.
echo Готово! Приложение открывается в браузере: http://localhost:5173
echo Чтобы остановить программу — просто закройте два открывшихся чёрных окна (Server и Client).
echo Это окно можно закрыть.
pause
