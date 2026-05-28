@echo off
cd /d "%~dp0backend"
echo Запуск бэкенда на http://localhost:8000 ...
python -m uvicorn main:app --host 0.0.0.0 --port 8002 --reload
pause
