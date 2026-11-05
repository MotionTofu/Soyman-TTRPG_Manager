@echo off
echo Запуск RPG Manager...

start "RPG Manager - Server" cmd /k "cd /d %~dp0server && npm run dev"
start "RPG Manager - Client" cmd /k "cd /d %~dp0client && npm run dev"

echo Ждём запуска серверов...
rem Vite слушает только IPv4 (127.0.0.1), а localhost на этой машине сначала
rem резолвится в ::1 — поэтому адрес явный, без localhost.
set "URL=http://127.0.0.1:5173"
rem Фиксированная пауза не годится: клиент перед Vite прогоняет sync-ui-assets,
rem а Vite на холодную пересобирает зависимости. Открытый слишком рано адрес
rem браузер подменяет своей страницей ошибки и вкладку больше не перезагружает.
set /a tries=0
:wait
set /a tries+=1
curl -s -o nul --max-time 2 %URL% >nul 2>&1 && goto ready
if %tries% geq 45 goto timeout
timeout /t 1 >nul
goto wait

:ready
start "" %URL%

echo.
echo Готово! Приложение открывается в браузере: %URL%
echo Чтобы остановить программу — просто закройте два открывшихся чёрных окна (Server и Client).
echo Это окно можно закрыть.
pause
exit /b

:timeout
echo.
echo Клиент не ответил за 45 секунд. Причина — в окне "RPG Manager - Client".
echo Когда оно покажет "ready", откройте адрес вручную: %URL%
pause
exit /b
