@echo off
REM Build the StoryKeep Windows installer. Run this from Windows, not from WSL —
REM Tauri does not cross-compile, so the .msi has to be produced here.
REM
REM Needs: Node.js 20+, Rust (rustup), and the "Desktop development with C++"
REM workload from the Visual Studio Build Tools.

setlocal
cd /d "%~dp0.."

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't on PATH. Install it from https://nodejs.org and reopen this terminal.
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust isn't on PATH. Install it from https://rustup.rs and reopen this terminal.
  exit /b 1
)

if not exist node_modules (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Building. The first run compiles every Rust dependency and takes a while.
call npm run app:build
if errorlevel 1 exit /b 1

echo.
echo Done. The installers are in:
echo   %CD%\src-tauri\target\release\bundle\msi
echo   %CD%\src-tauri\target\release\bundle\nsis
