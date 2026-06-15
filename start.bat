@echo off
setlocal enabledelayedexpansion
title Story-Lab-A111
cd /d "%~dp0"

echo.
echo ========================================
echo  Story-Lab-A111
echo  Port:  4090
echo  DB:    H:\MEDIA\Story_Lab\data\story-lab.db
echo  Open:  http://localhost:4090
echo  A1111: K:\stable-diffusion-webui  ^(port 7860^)
echo ========================================
echo.

:: Check Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install Node.js 22+ and try again.
    pause
    exit /b 1
)

:: Get version and warn if below 22 (built-in SQLite requires v22+)
for /f %%v in ('node --version') do set NODE_VER=%%v
set NODE_MAJOR=!NODE_VER:~1,2!
if !NODE_MAJOR! LSS 22 (
    echo [WARN] Node.js !NODE_VER! detected. Node 22+ required for built-in SQLite.
    echo        Continuing anyway -- upgrade Node.js if it crashes on startup.
    echo.
) else (
    echo [OK] Node.js !NODE_VER!
)

:: Check if already running on 4090
curl -s --connect-timeout 2 http://localhost:4090/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Server already running at http://localhost:4090
    echo      Close this window or press any key to stop it and relaunch.
    pause
)

:: Release port 4090 if something is lingering
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4090 " ^| findstr "LISTENING" 2^>nul') do (
    echo [KILL] Releasing port 4090 (PID %%a^)
    taskkill /PID %%a /F >nul 2>&1
)

:: ─── Check / launch A1111 ────────────────────────────────────────────────────
echo [A1111] Checking http://127.0.0.1:7860 ...
curl -s --connect-timeout 3 http://127.0.0.1:7860/sdapi/v1/memory >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK]    A1111 already running at http://127.0.0.1:7860
) else (
    echo [START] Launching A1111 from K:\stable-diffusion-webui ...
    start "Stable Diffusion WebUI" /D "K:\stable-diffusion-webui" cmd /c "webui-user.bat"
    echo [OK]    A1111 starting in its own window ^(takes ~30-60 s to load^).
)
echo.

echo [START] Launching Story-Lab server...
echo         Press Ctrl+C to stop.
echo.

node --experimental-sqlite --max-old-space-size=4096 src/server.js

echo.
echo [STOPPED] Server exited.
pause
