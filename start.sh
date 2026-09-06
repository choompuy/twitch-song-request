#!/bin/bash
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo "Node.js не найден. Установи с https://nodejs.org, потом запусти этот файл ещё раз."
  read -p "Нажми Enter для выхода..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Первый запуск, устанавливаю зависимости, это займёт минуту..."
  npm install
fi

read -p "Port (Enter — по умолчанию 3000): " PORT
export PORT=${PORT:-3000}

npm start
