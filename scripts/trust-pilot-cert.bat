@echo off
:: scripts/trust-pilot-cert.bat
:: One-click script to trust the Evolve AI Enterprise Pilot Code Signing Certificate
:: and remove Windows SmartScreen Mark-of-the-Web on test machines.

echo ======================================================================
echo   Evolve AI Enterprise Studio - Pilot Certificate Installer
echo ======================================================================
echo.

:: Check for administrative permissions
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Requesting Administrator privileges to install into Windows Trusted Root...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit /b
)

set CER_PATH=%~dp0evolve-enterprise-dev.cer
if not exist "%CER_PATH%" (
    set CER_PATH=%~dp0..\build-certs\evolve-enterprise-dev.cer
)
if not exist "%CER_PATH%" (
    echo [ERROR] Certificate file not found (checked %~dp0evolve-enterprise-dev.cer and %~dp0..\build-certs\evolve-enterprise-dev.cer)
    pause
    exit /b 1
)

echo [1/3] Adding certificate to Windows Trusted Publishers store...
certutil -addstore -f "TrustedPublisher" "%CER_PATH%" >nul
if %errorLevel% equ 0 (
    echo       - Added to Trusted Publishers: SUCCESS
) else (
    echo       - Added to Trusted Publishers: FAILED
)

echo [2/3] Adding certificate to Windows Trusted Root Certification Authorities...
certutil -addstore -f "Root" "%CER_PATH%" >nul
if %errorLevel% equ 0 (
    echo       - Added to Trusted Root CA: SUCCESS
) else (
    echo       - Added to Trusted Root CA: FAILED
)

echo [3/3] Unblocking executable binaries (removing Mark-of-the-Web)...
powershell -NoProfile -Command "$paths = @('%~dp0', '%USERPROFILE%\Downloads', '%~dp0..\dist-desktop'); foreach ($p in $paths) { if (Test-Path $p) { Get-ChildItem -Path $p -Filter 'evolve-ai-enterprise-*.exe' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue; Write-Host '      - Unblocked: ' $_.Name } } }"

echo.
echo ======================================================================
echo   [SUCCESS] Evolve AI Enterprise Studio is now trusted on this PC!
echo   Publisher: Evolve Mind Solutions Pty Ltd (Enterprise Pilot)
echo   SmartScreen will no longer block execution.
echo ======================================================================
echo.
pause
