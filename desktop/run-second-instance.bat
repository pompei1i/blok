@echo off
REM Launch a SECOND blok instance with its own login session (two-account testing).
REM Instance 1 = launch blok normally. Then double-click this file.
set BLOK_MULTI=1
set "EXE=%LOCALAPPDATA%\blok\blok.exe"
if not exist "%EXE%" set "EXE=%~dp0src-tauri\target\release\blok.exe"
if not exist "%EXE%" set "EXE=%~dp0src-tauri\target\debug\blok.exe"
if not exist "%EXE%" (
  echo Could not find blok.exe - install blok, or build it: npm run tauri build
  pause
  exit /b 1
)
echo Launching second instance from "%EXE%"
start "" "%EXE%"
