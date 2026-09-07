@echo off
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js не найден. Скачай и установи с https://nodejs.org, потом запусти этот файл ещё раз.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Первый запуск, устанавливаю зависимости, это займёт минуту...
  call npm install
)

set /p PORT="Port (Enter - default 3000): "
if "%PORT%"=="" set PORT=3000

call npm start
pause