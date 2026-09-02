@echo off
title llama-server (Story-Lab-A111 Narrator - MN-12B-Mag-Mell-R1.Q4)

set MODEL_PATH=J:\Models\MN-12B-Mag-Mell-R1\MN-12B-Mag-Mell-R1-Q4_K_M.gguf
set LLAMA_SERVER_EXE=C:\llama-cpp\llama-server.exe
set PORT=8080

echo.
echo ========================================
echo  Story-Lab-A111 - llama.cpp Narrator
echo  Model: MN-12B-Mag-Mell-R1.Q4
echo  Port:  %PORT%
echo  Context: 12288
echo  Sampling: Temp 1.25, Min-P 0.20
echo ========================================
echo.
echo  In Settings > Model Backends:
echo    Role: Narrator (or any role)
echo    Backend: llama.cpp
echo    Port: %PORT%
echo    Model path: %MODEL_PATH%
echo.

curl -s --connect-timeout 2 http://localhost:%PORT%/health 2>nul | findstr /i "ok" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] llama-server already running on port %PORT%
    pause
    exit /b 0
)

echo [INFO] Clearing port %PORT% if in use...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo [KILL] Terminating PID %%a on port %PORT%
    taskkill /PID %%a /F >nul 2>&1
)
echo.

echo [START] Launching llama-server...
echo [INFO]  Model will take 30-60s to load. Watch this window.
echo.

cd /d "C:\llama-cpp"
llama-server.exe ^
  -m "%MODEL_PATH%" ^
  --port %PORT% ^
  -ngl 99 ^
  -c 12288 ^
  --flash-attn on ^
  --cache-type-k q8_0 ^
  --cache-type-v q8_0 ^
  --temp 1.25 ^
  --min-p 0.20 ^
  --samplers "min_p;temperature" ^
  --cont-batching ^
  --mlock ^
  --host 0.0.0.0

echo.
echo [STOPPED] llama-server exited.
pause
