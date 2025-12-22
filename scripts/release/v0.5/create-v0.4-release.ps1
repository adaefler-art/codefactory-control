[CmdletBinding()]
param(
  [Parameter()] [string] $Repo = 'adaefler-art/codefactory-control',
  [Parameter()] [string] $Tag = 'v0.4.0',
  [Parameter()] [string] $TargetCommit = '22cdb6a41c42366ad165a0fb4c96282304f6f7ae',
  [Parameter()] [string] $Title = 'AFU-9 v0.4.0',
  [Parameter()] [string] $NotesFile = (Join-Path $PSScriptRoot 'release-notes-v0.4.0.md'),
  [Parameter()] [switch] $Execute
)

$ErrorActionPreference = 'Stop'

function Write-Step([string] $Text) {
  Write-Host "\n==> $Text" -ForegroundColor Cyan
}

Write-Step "Validate inputs"
if (-not (Test-Path -Path $NotesFile)) {
  throw "Notes file not found: $NotesFile"
}

Write-Step "Compute commands"
$commands = @(
  "git fetch --tags origin",
  "git tag -a $Tag $TargetCommit -m `"Release $Tag`"",
  "git push origin $Tag",
  "gh release create $Tag --repo $Repo --title `"$Title`" --notes-file `"$NotesFile`" --target $TargetCommit --verify-tag"
)

Write-Host "This script does NOT assume the tag already exists." -ForegroundColor Yellow
Write-Host "It creates and pushes an annotated tag '$Tag' on commit $TargetCommit." -ForegroundColor Yellow
Write-Host "\nPlanned commands:" -ForegroundColor Yellow
$commands | ForEach-Object { Write-Host "  $_" }

if (-not $Execute) {
  Write-Host "\nDry run only. Re-run with -Execute to run commands." -ForegroundColor Yellow
  exit 0
}

Write-Step "Run: git fetch --tags"
& git fetch --tags origin

Write-Step "Create annotated tag (idempotent-ish)"
$existingTag = (& git tag -l $Tag | Out-String).Trim()
if ($existingTag -eq $Tag) {
  Write-Host "Tag '$Tag' already exists locally; skipping tag creation." -ForegroundColor Yellow
} else {
  & git tag -a $Tag $TargetCommit -m "Release $Tag"
}

Write-Step "Push tag"
& git push origin $Tag

Write-Step "Create GitHub release (requires gh auth)"
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Write-Host "GitHub CLI 'gh' not found; create the release via Web UI or install gh." -ForegroundColor Yellow
  exit 0
}

& gh release create $Tag --repo $Repo --title $Title --notes-file $NotesFile --target $TargetCommit --verify-tag
