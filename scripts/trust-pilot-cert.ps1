# scripts/trust-pilot-cert.ps1
# Installs the enterprise pilot certificate into Windows Trusted Root & Trusted Publishers
# and strips Mark-of-the-Web (Zone.Identifier) from all packaged binaries.

[CmdletBinding()]
param (
    [string]$CerPath = "$PSScriptRoot\..\build-certs\evolve-enterprise-dev.cer",
    [string]$DistDir = "$PSScriptRoot\..\dist-desktop"
)

$ErrorActionPreference = "Stop"

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

if (-not (Test-Path $CerPath)) {
    Write-Error "Certificate not found at: $CerPath"
    exit 1
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CerPath)
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
if (Test-Path $DistDir) {
    $exes = Get-ChildItem -Path $DistDir -Recurse -Filter "*.exe"
    foreach ($exe in $exes) {
        Unblock-File -Path $exe.FullName -ErrorAction SilentlyContinue
        Write-Host "      ✓ Unblocked: $($exe.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  [SUCCESS] All Evolve AI Enterprise Studio executables are now trusted!" -ForegroundColor Green
Write-Host "  Windows Defender SmartScreen will no longer block execution." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
