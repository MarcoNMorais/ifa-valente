@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   IFA VALENTE - AVALIACAO DE DESEMPENHO
echo ==============================================
where python >nul 2>nul
if errorlevel 1 (
  echo Python nao encontrado. Instale o Python 3.11 ou superior.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Criando ambiente virtual...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)
start "" /b .venv\Scripts\python.exe -c "import time,webbrowser; time.sleep(2); webbrowser.open('http://127.0.0.1:5000/ifa')"
python app.py
pause
