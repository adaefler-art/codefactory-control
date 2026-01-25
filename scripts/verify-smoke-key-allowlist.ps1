# Verify AFU9 smoke-key allowlist entries (E9.1)
# Prerequisite: DATABASE_URL or psql connection info is configured

param(
  [string]$DbHost = "",
  [string]$DbName = "",
  [string]$DbUser = "",
  [string]$DbPort = "",
  [string]$DbSslMode = "require"
)

function Invoke-Query {
  param([string]$Query)

  if ($env:DATABASE_URL -and $env:DATABASE_URL.Trim().Length -gt 0) {
    psql $env:DATABASE_URL -c $Query
    return
  }

  if ([string]::IsNullOrWhiteSpace($DbHost) -or [string]::IsNullOrWhiteSpace($DbName)) {
    throw "Provide DATABASE_URL or -DbHost/-DbName (and optionally -DbUser/-DbPort)."
  }

  $args = @("-h", $DbHost, "-d", $DbName)
  if (-not [string]::IsNullOrWhiteSpace($DbUser)) { $args += @("-U", $DbUser) }
  if (-not [string]::IsNullOrWhiteSpace($DbPort)) { $args += @("-p", $DbPort) }
  if (-not [string]::IsNullOrWhiteSpace($DbSslMode)) { $args += @("sslmode=$DbSslMode") }

  psql @args -c $Query
}

Write-Host "Checking smoke_key_allowlist entries added by migration 087..."
Invoke-Query "SELECT COUNT(*) AS active_routes FROM smoke_key_allowlist WHERE removed_at IS NULL AND added_by = 'system:migration:087';"

Write-Host "Listing active smoke-key allowlist entries for E9.1..."
Invoke-Query "SELECT route_pattern, method, is_regex, description FROM smoke_key_allowlist WHERE removed_at IS NULL AND added_by = 'system:migration:087' ORDER BY route_pattern, method;"
