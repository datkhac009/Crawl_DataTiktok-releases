@echo off
REM Khoi chay app o che do dev voi HOT-RELOAD (electronmon).
REM Sua giao dien (HTML/JS) -> tu reload. Sua logic nen (src\*.cjs, main.js) -> tu restart.
set "ELECTRON_RUN_AS_NODE="
set "PORTABLE_EXECUTABLE_DIR="
cd /d "%~dp0"
call node_modules\.bin\electronmon.cmd .
