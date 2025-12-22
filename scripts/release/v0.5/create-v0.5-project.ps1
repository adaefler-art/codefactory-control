[CmdletBinding()]
param(
  [Parameter()] [string] $Owner = 'adaefler-art',
  [Parameter()] [string] $ProjectTitle = 'AFU-9 Codefactory v0.5',
  [Parameter()] [switch] $Execute
)

$ErrorActionPreference = 'Stop'

function Write-Step([string] $Text) {
  Write-Host "\n==> $Text" -ForegroundColor Cyan
}

Write-Host "This script prints (and optionally runs) GitHub CLI commands." -ForegroundColor Yellow
Write-Host "It does NOT assume any resources already exist." -ForegroundColor Yellow

$commands = @(
  "gh project create --owner $Owner --title `"$ProjectTitle`"",
  "# After creating the project, create issues (examples):",
  "# gh issue create --title \"[v0.5 Epic] Self-Propelling\" --label v0.5,epic,self-propelling",
  "# gh issue create --title \"Task: Make runtime artifact access explicit\" --label v0.5,hardening",
  "# ... (use docs/v05/V05_RELEASE_PREP.md for the authoritative list)"
)

Write-Step "Planned commands"
$commands | ForEach-Object { Write-Host "  $_" }

if (-not $Execute) {
  Write-Host "\nDry run only. Re-run with -Execute to run commands." -ForegroundColor Yellow
  exit 0
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  throw "GitHub CLI 'gh' not found. Install gh or run manually via Web UI."
}

Write-Step "Create project"
& gh project create --owner $Owner --title $ProjectTitle
Write-Host "\nNext: create issues and configure project fields per docs." -ForegroundColor Yellow
