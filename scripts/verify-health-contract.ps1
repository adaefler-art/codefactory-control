param(
  [string]$BaseUrl = "https://stage.afu-9.com",
  [string]$ExpectedVersion = "2026-01-26"
)

$healthUrl = "$BaseUrl/api/health"

try {
  $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 10
} catch {
  Write-Error "Failed to fetch $healthUrl: $($_.Exception.Message)"
  exit 1
}

if (-not $response.healthContractVersion) {
  Write-Error "Missing healthContractVersion from $healthUrl"
  exit 1
}

if ($response.healthContractVersion -ne $ExpectedVersion) {
  Write-Error "healthContractVersion mismatch. Expected '$ExpectedVersion' got '$($response.healthContractVersion)'"
  exit 1
}

Write-Host "healthContractVersion OK ($($response.healthContractVersion))"
