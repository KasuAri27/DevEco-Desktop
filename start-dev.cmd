@echo off
setlocal

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
    echo Could not open the project folder.
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Electron is missing. Run npm install in this project folder first.
    popd
    pause
    exit /b 1
)

if not exist "node_modules\jsonc-parser\package.json" (
    echo Project dependencies are missing. Run npm install first.
    popd
    pause
    exit /b 1
)

set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
if errorlevel 1 (
    echo Could not start DevEco Agent Desktop.
    popd
    pause
    exit /b 1
)

popd
endlocal
