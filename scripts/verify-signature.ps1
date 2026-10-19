# scripts/verify-signature.ps1
# Inspects an executable and outputs its Authenticode signature details as JSON.
param (
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $FilePath)) {
    Write-Error "File not found: $FilePath"
    exit 1
}

$sig = Get-AuthenticodeSignature -FilePath $FilePath

$statusStr = $sig.Status.ToString()
$isSigned = ($sig.Status -eq [System.Management.Automation.SignatureStatus]::Valid) -or ($sig.SignerCertificate -ne $null)

$result = [PSCustomObject]@{
    FilePath         = $FilePath
    FileName         = Split-Path $FilePath -Leaf
    Signed           = $isSigned
    Status           = $statusStr
    StatusMessage    = $sig.StatusMessage
    Subject          = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
    Issuer           = if ($sig.SignerCertificate) { $sig.SignerCertificate.Issuer } else { $null }
    Thumbprint       = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { $null }
    NotAfter         = if ($sig.SignerCertificate) { $sig.SignerCertificate.NotAfter.ToString("yyyy-MM-dd HH:mm:ss") } else { $null }
    TimestampSubject = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { $null }
    TimestampIssuer  = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Issuer } else { $null }
}

$result | ConvertTo-Json -Compress
