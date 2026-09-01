@echo off
REM StoryKeep build.
REM
REM   Double-click, or `build`      release build: the exe and the installers
REM   build dev                     dev build: opens the app, reloads the UI as
REM                                 you edit, rebuilds Rust when a .rs file is saved
REM   build check                   type-check, lint, format check, both test
REM                                 suites; builds nothing
REM
REM Needs Node.js 20+, Rust (rustup), and the "Desktop development with C++"
REM workload from the Visual Studio Build Tools. Tauri does not cross-compile,
REM so this must run on Windows to produce a Windows exe.

setlocal
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=release"
set "EXIT=0"

REM Launched from Explorer there is no terminal left to read once this ends,
REM so hold the window open. cmd's own command line carries /c in that case,
REM but so does a script run from PowerShell, so only a bare launch with no
REM arguments counts: `build dev` and `build check` never wait.
set "INTERACTIVE=0"
if "%~1"=="" echo %cmdcmdline% | find /i "/c" >nul && set "INTERACTIVE=1"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't on PATH. Install it from https://nodejs.org and reopen this terminal.
  goto :fail
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust isn't on PATH. Install it from https://rustup.rs and reopen this terminal.
  goto :fail
)

if not exist node_modules (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

if /i "%MODE%"=="dev" goto :dev
if /i "%MODE%"=="check" goto :check
if /i "%MODE%"=="release" goto :release

echo Unknown mode "%MODE%". Use: build, build dev, or build check.
goto :fail

:dev
echo Starting the dev build. Close the app window to stop it.
call npm run app
if errorlevel 1 goto :fail
goto :done

:check
call npm run check
if errorlevel 1 goto :fail
echo.
echo Everything passes.
goto :done

:release
echo Release build. The first run compiles every Rust dependency and takes a while.
echo.
call npm run app:build
if errorlevel 1 goto :fail
echo.
echo Done. Built:
echo   %CD%\src-tauri\target\release\storykeep.exe
echo   %CD%\src-tauri\target\release\bundle\msi
echo   %CD%\src-tauri\target\release\bundle\nsis
if "%INTERACTIVE%"=="1" (
  echo.
  choice /c YN /t 15 /d N /m "Open StoryKeep now"
  if not errorlevel 2 start "" "%CD%\src-tauri\target\release\storykeep.exe"
)
goto :done

:fail
echo.
echo Build failed.
set "EXIT=1"

:done
if "%INTERACTIVE%"=="1" pause
exit /b %EXIT%
