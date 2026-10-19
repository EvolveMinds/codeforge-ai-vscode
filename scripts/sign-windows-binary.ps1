# scripts/sign-windows-binary.ps1
# Applies Authenticode Code Signing to Windows Executables (.exe / .dll).
param (
    [Parameter(Mandatory=$true)]
    [string]$FilePath,
    [string]$PfxPath = "",
    [string]$Password = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PfxPath)) {
    $PfxPath = Join-Path $PSScriptRoot "..\build-certs\evolve-enterprise-dev.pfx"
}
$PfxPath = [System.IO.Path]::GetFullPath($PfxPath)

if (-not (Test-Path $FilePath)) {
    Write-Error "Target file not found: $FilePath"
    exit 1
}

# Resolve Password
if ([string]::IsNullOrWhiteSpace($Password)) {
    $pwdFile = Join-Path (Split-Path $PfxPath) ".cert-password"
    if (Test-Path $pwdFile) {
        $Password = (Get-Content $pwdFile -Raw).Trim()
    } else {
        $Password = "EvolveEnterprise2026!Secure"
    }
}

if (-not (Test-Path $PfxPath)) {
    Write-Error "Certificate PFX not found at: $PfxPath"
    exit 1
}

$fileName = Split-Path $FilePath -Leaf
Write-Host "==============================================================="
Write-Host "  Authenticode Code Signing Pipeline"
Write-Host "  Target File: $fileName"
Write-Host "  Certificate: $(Split-Path $PfxPath -Leaf)"
Write-Host "==============================================================="

# 1. Load Certificate with Private Key
$certFlags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable -bor `
             [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::PersistKeySet

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
    $PfxPath,
    $Password,
    $certFlags
)

Write-Host "  ✓ Signer: $($cert.Subject)"
Write-Host "  ✓ Thumbprint: $($cert.Thumbprint)"
Write-Host "  ✓ Valid Until: $($cert.NotAfter)"

# 2. Apply Authenticode Signature
$signature = $null
if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
    try {
        Write-Host "  - Applying SHA-256 signature with RFC 3161 timestamp ($TimestampUrl)..."
        $signature = Set-AuthenticodeSignature -FilePath $FilePath -Certificate $cert -TimestampServer $TimestampUrl -HashAlgorithm SHA256
    } catch {
        Write-Warning "Timestamp server unreachable ($($_.Exception.Message)). Signing with local clock..."
        $signature = Set-AuthenticodeSignature -FilePath $FilePath -Certificate $cert -HashAlgorithm SHA256
    }
} else {
    Write-Host "  - Applying SHA-256 signature without timestamp..."
    $signature = Set-AuthenticodeSignature -FilePath $FilePath -Certificate $cert -HashAlgorithm SHA256
}

# 3. Verify Authenticode Signature Block
$verify = Get-AuthenticodeSignature -FilePath $FilePath
Write-Host "  ✓ Signature Status: $($verify.Status)"
Write-Host "  ✓ Signature Message: $($verify.StatusMessage)"
if ($verify.TimeStamperCertificate) {
    Write-Host "  ✓ Timestamp Issuer: $($verify.TimeStamperCertificate.Subject)"
}

Write-Host "==============================================================="
Write-Host "  Authenticode Signing Completed: $fileName"
Write-Host "==============================================================="
