@echo off
REM Launch a SECOND blok instance with its own login session (for voice testing).
REM Double-click this file. Instance 1 = double-click blok.exe normally.
set BLOK_MULTI=1
echo BLOK_MULTI is now [%BLOK_MULTI%] - launching second instance...
start "" "D:\blok\desktop\src-tauri\target\release\blok.exe"
