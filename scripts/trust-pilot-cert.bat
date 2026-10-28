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
    echo [INFO] Local certificate file not found. Extracting embedded pilot certificate...
    set CER_PATH=%TEMP%\evolve-enterprise-dev.cer
    (
        echo -----BEGIN CERTIFICATE-----
        echo MIIDRjCCAi6gAwIBAgIQaQQYdD9LYJ9HRRCmlWoxnTANBgkqhkiG9w0BAQsFADA7MTkwNwYDVQQD
        echo DDBFdm9sdmUgTWluZCBTb2x1dGlvbnMgUHR5IEx0ZCAoRW50ZXJwcmlzZSBQaWxvdCkwHhcNMjYx
        echo MDE5MDQyMDIzWhcNMzExMDE5MDQzMDIzWjA7MTkwNwYDVQQDDDBFdm9sdmUgTWluZCBTb2x1dGlv
        echo bnMgUHR5IEx0ZCAoRW50ZXJwcmlzZSBQaWxvdCkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
        echo AoIBAQC2ClJ2O5XzhkoBvkpI5NrMauQEYHzF5sZkdeTFUPrMbozhqD7WM/KCl1DLvL2+cpetGz9n
        echo IrI6QFHR46lgR0/qx3ww7Ag1seKNl+zB25hhkk/2cfc4O+59kQv+cnWsYpo7re3q1+X4eycD6uFZ
        echo 6lK+bh9btHmjEAnBYuG601noMEm2gZDS5jTzuEt6VkTIFt9JhgRzfxANSqqDIf9Sdy5zI8xlTN+b
        echo CRU6ieX4OBlHl03PCW1Q9Bs3m5TclD5H1P2OyQjFX+lHcHMiWdwpGJDAxNCum0Bk20jGBKEhPQfj
        echo TWOEDViAXfVgTZCrLj8RBKguF33O9RJ63QQ2lwdi6DS9AgMBAAGjRjBEMA4GA1UdDwEB/wQEAwIH
        echo gDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNVHQ4EFgQUg0w0/she8JGj6M3tel/ANTcOdP0wDQYJ
        echo KoZIhvcNAQELBQADggEBABTBujXb5YdDQWskK892W0oPZGMPFe6BDtPTNeoIFFGZlK3XvCTcChgp
        echo GKr9IQNYSzBdMffHap/CZxiCs4zeZDiVo0i14KFniSM0NuLywhNR2rMw01LGP1Tp7P3TycqfseuS
        echo K5TW4FC+iNXQpoRG/UTWjR9T91XoyT7Z8JQHCXSSpn0WLeP6easRkKGYC2ayXka8dSinSnzoN7Vl
        echo /Wn+/YLiIIX/NT4YeEkEaYDpC7hBWve66/74VwcZQhg2Fb59DY91MMCghjmg7V2lI5eI5tCVYXGd
        echo RqPoEoIzRheNf3PP6s4h5hTPEAV5GUcj3ptJ59UzVkYHex7cGrlAxSVthyg=
        echo -----END CERTIFICATE-----
    ) > "%TEMP%\evolve-enterprise-dev-b64.pem"
    certutil -decode "%TEMP%\evolve-enterprise-dev-b64.pem" "%CER_PATH%" >nul 2>&1
    if not exist "%CER_PATH%" (
        set CER_PATH=%TEMP%\evolve-enterprise-dev-b64.pem
    )
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
