[CmdletBinding()]
param(
  [Parameter()] [string] $Repo = 'adaefler-art/codefactory-control',
  [Parameter()] [string] $Tag = 'v0.4.0',
  [Parameter()] [string] $TargetCommit = '22cdb6a41c42366ad165a0fb4c96282304f6f7ae',
  [Parameter()] [string] $Owner = 'adaefler-art',
  [Parameter()] [string] $ProjectTitle = 'AFU-9 Codefactory v0.5',
  [Parameter()] [switch] $Execute
)

$ErrorActionPreference = 'Stop'

function Write-Step([string] $Text) {
  Write-Host "\n==> $Text" -ForegroundColor Cyan
}

Write-Step "v0.4 release: tag + release"
& (Join-Path $PSScriptRoot 'create-v0.4-release.ps1') -Repo $Repo -Tag $Tag -TargetCommit $TargetCommit -Execute:$Execute

Write-Step "v0.5 project: create project + issue templates"
& (Join-Path $PSScriptRoot 'create-v0.5-project.ps1') -Owner $Owner -ProjectTitle $ProjectTitle -Execute:$Execute

Write-Host "\nDone. If you ran in dry-run mode, re-run with -Execute." -ForegroundColor Yellow
