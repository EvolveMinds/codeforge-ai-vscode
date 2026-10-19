# scripts/generate-dev-cert.ps1
# Generates an X.509 Code Signing Certificate for Evolve AI Enterprise Studio development & pilot testing.
param (
    [string]$OutputDir = "$PSScriptRoot\..\build-certs",
    [string]$Subject = "CN=Evolve Mind Solutions Pty Ltd (Enterprise Pilot)",
    [string]$Password = "EvolveEnterprise2026!Secure"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$pfxPath = Join-Path $OutputDir "evolve-enterprise-dev.pfx"
$cerPath = Join-Path $OutputDir "evolve-enterprise-dev.cer"
$pwdPath = Join-Path $OutputDir ".cert-password"

Write-Host "==============================================================="
Write-Host "  Generating X.509 Code Signing Certificate"
Write-Host "  Subject: $Subject"
Write-Host "  Target PFX: $pfxPath"
Write-Host "==============================================================="

# 1. Create Self-Signed Code Signing Certificate with EKU OID 1.3.6.1.5.5.7.3.3
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -NotAfter (Get-Date).AddYears(5) `
    -CertStoreLocation "Cert:\CurrentUser\My"

Write-Host "  ✓ Certificate created in CurrentUser\My Store"
Write-Host "  ✓ Thumbprint: $($cert.Thumbprint)"
Write-Host "  ✓ Valid Until: $($cert.NotAfter)"

# 2. Export Private Key and Certificate to PKCS#12 (.pfx)
$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate `
    -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
    -FilePath $pfxPath `
    -Password $securePassword | Out-Null

Write-Host "  ✓ Exported PKCS#12 Private Key: $pfxPath"

# 3. Export Public Key Certificate (.cer)
Export-Certificate `
    -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
    -FilePath $cerPath | Out-Null

Write-Host "  ✓ Exported Public Certificate: $cerPath"

# 4. Save password file
Set-Content -Path $pwdPath -Value $Password -Force
Write-Host "  ✓ Saved credentials reference to: $pwdPath"

Write-Host "==============================================================="
Write-Host "  Code Signing Certificate Successfully Ready!"
Write-Host "==============================================================="
