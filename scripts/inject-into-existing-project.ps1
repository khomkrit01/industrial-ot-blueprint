<#
.SYNOPSIS
  Injects the Industrial OT Monorepo Blueprint Skill and WDAC/Release Tooling into an existing project.
.PARAMETER TargetProjectPath
  Path to the existing project folder you want to upgrade/refactor.
#>
param(
  [Parameter(Mandatory=$true)]
  [string]$TargetProjectPath
)

$ErrorActionPreference = "Stop"
$BlueprintRoot = Split-Path -Parent $PSScriptRoot
$ResolvedTarget = Resolve-Path $TargetProjectPath

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " Injecting Industrial OT Blueprint into: $ResolvedTarget" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Copy Agent Skill (.agents/skills/industrial-ot-monorepo-blueprint)
$SkillSrc = Join-Path $BlueprintRoot ".agents\skills\industrial-ot-monorepo-blueprint"
$SkillDest = Join-Path $ResolvedTarget ".agents\skills\industrial-ot-monorepo-blueprint"
New-Item -ItemType Directory -Force -Path $SkillDest | Out-Null
Copy-Item -Path "$SkillSrc\*" -Destination $SkillDest -Recurse -Force
Write-Host "[OK] Installed Agent Skill: .agents/skills/industrial-ot-monorepo-blueprint" -ForegroundColor Green

# 2. Copy tools/ directory (non-destructive if custom tools exist, overwrites blueprint tools)
$ToolsSrc = Join-Path $BlueprintRoot "tools"
$ToolsDest = Join-Path $ResolvedTarget "tools"
New-Item -ItemType Directory -Force -Path $ToolsDest | Out-Null
Copy-Item -Path "$ToolsSrc\*" -Destination $ToolsDest -Recurse -Force
Write-Host "[OK] Installed Release & WDAC Tools: tools/" -ForegroundColor Green

# 3. Copy customers/sites-registry.json if not present
$CustomersDest = Join-Path $ResolvedTarget "customers"
if (-not (Test-Path (Join-Path $CustomersDest "sites-registry.json"))) {
  New-Item -ItemType Directory -Force -Path $CustomersDest | Out-Null
  Copy-Item -Path (Join-Path $BlueprintRoot "customers\sites-registry.json") -Destination $CustomersDest -Force
  Write-Host "[OK] Created customers/sites-registry.json" -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE! Next step: Open '$ResolvedTarget' in Antigravity IDE and prompt the agent:" -ForegroundColor Yellow
Write-Host '  "ใช้ skill industrial-ot-monorepo-blueprint เพื่อปรับโครงสร้างโปรเจกต์นี้ให้เป็นมาตรฐาน Industrial OT Monorepo"' -ForegroundColor White
