# scripts/trust-pilot-cert.ps1
# Installs the enterprise pilot certificate into Windows Trusted Root & Trusted Publishers
# and strips Mark-of-the-Web (Zone.Identifier) from all packaged binaries.

[CmdletBinding()]
param (
    [string]$CerPath = "",
    [string]$DistDir = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CerPath)) {
    if (Test-Path "$PSScriptRoot\evolve-enterprise-dev.cer") {
        $CerPath = "$PSScriptRoot\evolve-enterprise-dev.cer"
    } elseif (Test-Path "$PSScriptRoot\..\build-certs\evolve-enterprise-dev.cer") {
        $CerPath = "$PSScriptRoot\..\build-certs\evolve-enterprise-dev.cer"
    } else {
        $CerPath = "$PSScriptRoot\evolve-enterprise-dev.cer"
    }
}

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  Evolve AI Enterprise Studio — Windows Trust Configuration" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# Self-elevate if not administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[INFO] Re-launching with elevated administrator privileges..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 0
}

$cert = $null
if (-not [string]::IsNullOrWhiteSpace($CerPath) -and (Test-Path $CerPath)) {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CerPath)
} else {
    Write-Host "[INFO] Local certificate file not found. Loading embedded pilot certificate..." -ForegroundColor Yellow
    $b64Cert = "MIIDRjCCAi6gAwIBAgIQaQQYdD9LYJ9HRRCmlWoxnTANBgkqhkiG9w0BAQsFADA7MTkwNwYDVQQDDDBFdm9sdmUgTWluZCBTb2x1dGlvbnMgUHR5IEx0ZCAoRW50ZXJwcmlzZSBQaWxvdCkwHhcNMjYxMDE5MDQyMDIzWhcNMzExMDE5MDQzMDIzWjA7MTkwNwYDVQQDDDBFdm9sdmUgTWluZCBTb2x1dGlvbnMgUHR5IEx0ZCAoRW50ZXJwcmlzZSBQaWxvdCkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC2ClJ2O5XzhkoBvkpI5NrMauQEYHzF5sZkdeTFUPrMbozhqD7WM/KCl1DLvL2+cpetGz9nIrI6QFHR46lgR0/qx3ww7Ag1seKNl+zB25hhkk/2cfc4O+59kQv+cnWsYpo7re3q1+X4eycD6uFZ6lK+bh9btHmjEAnBYuG601noMEm2gZDS5jTzuEt6VkTIFt9JhgRzfxANSqqDIf9Sdy5zI8xlTN+bCRU6ieX4OBlHl03PCW1Q9Bs3m5TclD5H1P2OyQjFX+lHcHMiWdwpGJDAxNCum0Bk20jGBKEhPQfjTWOEDViAXfVgTZCrLj8RBKguF33O9RJ63QQ2lwdi6DS9AgMBAAGjRjBEMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDAzAdBgNVHQ4EFgQUg0w0/she8JGj6M3tel/ANTcOdP0wDQYJKoZIhvcNAQELBQADggEBABTBujXb5YdDQWskK892W0oPZGMPFe6BDtPTNeoIFFGZlK3XvCTcChgpGKr9IQNYSzBdMffHap/CZxiCs4zeZDiVo0i14KFniSM0NuLywhNR2rMw01LGP1Tp7P3TycqfseuSK5TW4FC+iNXQpoRG/UTWjR9T91XoyT7Z8JQHCXSSpn0WLeP6easRkKGYC2ayXka8dSinSnzoN7Vl/Wn+/YLiIIX/NT4YeEkEaYDpC7hBWve66/74VwcZQhg2Fb59DY91MMCghjmg7V2lI5eI5tCVYXGdRqPoEoIzRheNf3PP6s4h5hTPEAV5GUcj3ptJ59UzVkYHex7cGrlAxSVthyg="
    $certBytes = [Convert]::FromBase64String($b64Cert)
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(,$certBytes)
}
Write-Host "Target Certificate: $($cert.Subject)" -ForegroundColor White
Write-Host "Thumbprint:         $($cert.Thumbprint)" -ForegroundColor White
Write-Host ""

# 1. Install to LocalMachine\TrustedPublisher
Write-Host "[1/3] Installing to LocalMachine\TrustedPublisher..." -ForegroundColor White
$storePub = New-Object System.Security.Cryptography.X509Certificates.X509Store([System.Security.Cryptography.X509Certificates.StoreName]::TrustedPublisher, [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
$storePub.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$storePub.Add($cert)
$storePub.Close()
Write-Host "      ✓ Added to Trusted Publishers" -ForegroundColor Green

# 2. Install to LocalMachine\Root
Write-Host "[2/3] Installing to LocalMachine\Root (Trusted Root Certification Authorities)..." -ForegroundColor White
$storeRoot = New-Object System.Security.Cryptography.X509Certificates.X509Store([System.Security.Cryptography.X509Certificates.StoreName]::Root, [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
$storeRoot.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$storeRoot.Add($cert)
$storeRoot.Close()
Write-Host "      ✓ Added to Trusted Root CA" -ForegroundColor Green

# 3. Unblock executables
Write-Host "[3/3] Stripping Mark-of-the-Web (Zone.Identifier) from binaries..." -ForegroundColor White
$searchDirs = @($PSScriptRoot, "$env:USERPROFILE\Downloads", "$PSScriptRoot\..\dist-desktop")
if (-not [string]::IsNullOrWhiteSpace($DistDir) -and (Test-Path $DistDir)) {
    $searchDirs += $DistDir
}
foreach ($d in $searchDirs) {
    if (Test-Path $d) {
        $exes = Get-ChildItem -Path $d -Filter "evolve-ai-enterprise-*.exe" -Recurse -ErrorAction SilentlyContinue
        foreach ($exe in $exes) {
            Unblock-File -Path $exe.FullName -ErrorAction SilentlyContinue
            Write-Host "      ✓ Unblocked: $($exe.Name)" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  [SUCCESS] All Evolve AI Enterprise Studio executables are now trusted!" -ForegroundColor Green
Write-Host "  Windows Defender SmartScreen will no longer block execution." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
