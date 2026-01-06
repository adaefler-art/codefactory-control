#!/usr/bin/env pwsh
<#
.SYNOPSIS
    ECS Task Definition Update Helper for AFU9_ADMIN_SUBS

.DESCRIPTION
    This script provides guidance and code snippets for updating the ECS task
    definition to inject the AFU9_ADMIN_SUBS secret from AWS Secrets Manager.
    
    Features:
    - Checks if infra code exists in the repository
    - Displays TypeScript code snippet for ECS secret injection
    - Provides step-by-step deployment instructions
    - Shows verification commands
    
    This is a helper script that provides instructions rather than making
    automatic changes, as infrastructure code modification requires careful
    review and testing.

.EXAMPLE
    .\scripts\update-task-definition-admin-subs.ps1
    Display instructions and code snippets

.NOTES
    Version: 1.0
    Author: AFU-9 Team
    Related: E80.1 Implementation Summary
    
    This script is informational only and does not modify files.
    It provides the code snippet you need to manually add to your
    infrastructure code.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error-Message {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning-Message {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Cyan
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host "  $Message" -ForegroundColor Magenta
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host ""
}

function Write-Code {
    param([string[]]$Lines)
    Write-Host ""
    foreach ($line in $Lines) {
        Write-Host $line -ForegroundColor White
    }
    Write-Host ""
}

# ============================================================================
# Main Script
# ============================================================================

Write-Header "ECS Task Definition Update Helper (E80.1)"

Write-Info "This script provides guidance for updating your ECS task definition"
Write-Info "to inject the AFU9_ADMIN_SUBS secret from AWS Secrets Manager."
Write-Host ""

# ============================================================================
# Step 1: Check Infrastructure Code
# ============================================================================

Write-Header "Step 1: Checking Infrastructure Code"

$infraPath = Join-Path $PSScriptRoot ".." "infra" "lib" "control-center-service.ts"
$altPath = Join-Path $PSScriptRoot ".." "lib" "afu9-ecs-stack.ts"

function Test-AdminSubsPresent {
    param([string]$Path)
    try {
        $content = Get-Content -Path $Path -Raw
        return ($content -match "AFU9_ADMIN_SUBS")
    } catch {
        return $false
    }
}

if (Test-Path $infraPath) {
    Write-Success "Found infrastructure code: $infraPath"
    
    # Check if AFU9_ADMIN_SUBS is already configured
    if (Test-AdminSubsPresent -Path $infraPath) {
        Write-Warning-Message "AFU9_ADMIN_SUBS already present in task definition"
        Write-Info "Review the existing configuration to ensure it's correct"
    } else {
        Write-Info "AFU9_ADMIN_SUBS not yet configured in task definition"
    }
} elseif (Test-Path $altPath) {
    Write-Success "Found infrastructure code: $altPath"

    if (Test-AdminSubsPresent -Path $altPath) {
        Write-Warning-Message "AFU9_ADMIN_SUBS already present in task definition"
        Write-Info "Review the existing configuration to ensure it's correct"
    } else {
        Write-Info "AFU9_ADMIN_SUBS not yet configured in task definition"
    }
} else {
    Write-Warning-Message "Infrastructure code not found at expected locations"
    Write-Info "Looked for:"
    Write-Info "  - $infraPath"
    Write-Info "  - $altPath"
    Write-Info "You'll need to apply this change in your infrastructure repository"
}

# ============================================================================
# Step 2: Code Snippet
# ============================================================================

Write-Header "Step 2: Code Snippet for ECS Task Definition"

Write-Info "Add the following to your ECS task definition secrets configuration:"
Write-Host ""

$codeSnippet = @(
    "// In your ECS task definition (e.g., control-center-service.ts)",
    "// Add to the 'secrets' section of your container definition:",
    "",
    "secrets: {",
    "  // ... existing secrets (DATABASE_PASSWORD, etc.) ...",
    "  ",
    "  // E80.1: Admin subscription IDs for ops endpoints",
    "  AFU9_ADMIN_SUBS: ecs.Secret.fromSecretsManager(",
    "    secretsmanager.Secret.fromSecretNameV2(",
    "      this,",
    "      'AdminSubsSecret',",
    '      `afu9/${props.environment}/admin-subs`  // TypeScript template literal',
    "    ),",
    "    'admin_subs'  // JSON key within the secret",
    "  ),",
    "}",
    "",
    "// Required imports (add to top of file if not present):",
    "import * as ecs from 'aws-cdk-lib/aws-ecs';",
    "import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';"
)

foreach ($line in $codeSnippet) {
    if ($line -match "^//") {
        Write-Host $line -ForegroundColor DarkGray
    } elseif ($line -match "AFU9_ADMIN_SUBS|AdminSubsSecret|admin_subs") {
        Write-Host $line -ForegroundColor Yellow
    } elseif ($line -match "import") {
        Write-Host $line -ForegroundColor Cyan
    } else {
        Write-Host $line -ForegroundColor White
    }
}

Write-Host ""

# ============================================================================
# Step 3: Alternative Pattern (if using different CDK construct)
# ============================================================================

Write-Header "Step 3: Alternative Pattern (Fargate Task Definition)"

Write-Info "If you're using addContainer() on a Fargate task definition:"
Write-Host ""

$alternativeSnippet = @(
    "// When adding container to task definition:",
    "const container = taskDefinition.addContainer('ControlCenter', {",
    "  // ... other container properties ...",
    "  ",
    "  secrets: {",
    "    // ... existing secrets ...",
    "    ",
    "    AFU9_ADMIN_SUBS: ecs.Secret.fromSecretsManager(",
    "      secretsmanager.Secret.fromSecretNameV2(",
    "        this,",
    "        'AdminSubsSecret',",
    '        `afu9/${props.environment}/admin-subs`  // TypeScript template literal',
    "      ),",
    "      'admin_subs'",
    "    ),",
    "  },",
    "});"
)

foreach ($line in $alternativeSnippet) {
    if ($line -match "^//") {
        Write-Host $line -ForegroundColor DarkGray
    } elseif ($line -match "AFU9_ADMIN_SUBS|AdminSubsSecret|admin_subs") {
        Write-Host $line -ForegroundColor Yellow
    } else {
        Write-Host $line -ForegroundColor White
    }
}

Write-Host ""

# ============================================================================
# Step 4: Deployment Steps
# ============================================================================

Write-Header "Step 4: Deployment Steps"

Write-Host "After adding the code snippet:" -ForegroundColor Cyan
Write-Host ""

$steps = @(
    "1. Save the modified infrastructure file",
    "2. Run CDK synth to verify the change:",
    "   npm run synth",
    "3. Review the synthesized CloudFormation template",
    "4. Deploy to the target environment:",
    "   npm run deploy",
    "5. Verify the secret is injected in ECS task definition"
)

foreach ($step in $steps) {
    if ($step -match "^\d+\.") {
        Write-Host $step -ForegroundColor Yellow
    } else {
        Write-Host $step -ForegroundColor White
    }
}

Write-Host ""

# ============================================================================
# Step 5: Verification Commands
# ============================================================================

Write-Header "Step 5: Verification Commands"

Write-Info "After deployment, verify the secret injection:"
Write-Host ""

$verifyCommands = @(
    "# Check task definition (replace {environment} with stage or prod):",
    "aws ecs describe-task-definition \",
    "  --task-definition afu9-control-center-{environment} \",
    "  --query 'taskDefinition.containerDefinitions[0].secrets' \",
    "  --output json",
    "",
    "# Expected output should include:",
    "{",
    '  "name": "AFU9_ADMIN_SUBS",',
    '  "valueFrom": "arn:aws:secretsmanager:eu-central-1:...:secret:afu9/{env}/admin-subs:admin_subs::"',
    "}",
    "",
    "# Test the migration parity endpoint:",
    "# Use GitHub Actions workflow: migration-parity.yml",
    "# Or call API with admin auth (see docs/runbooks/MIGRATION_PARITY_CHECK.md)"
)

foreach ($line in $verifyCommands) {
    if ($line -match "^#") {
        Write-Host $line -ForegroundColor DarkGray
    } elseif ($line -match "AFU9_ADMIN_SUBS|admin-subs") {
        Write-Host $line -ForegroundColor Yellow
    } elseif ($line -match "aws ecs|npm run") {
        Write-Host $line -ForegroundColor Cyan
    } else {
        Write-Host $line -ForegroundColor White
    }
}

Write-Host ""

# ============================================================================
# Step 6: Troubleshooting
# ============================================================================

Write-Header "Step 6: Troubleshooting Tips"

$troubleshooting = @(
    "If the secret is not appearing in the ECS task:",
    "",
    "1. Verify the secret exists in AWS Secrets Manager:",
    "   aws secretsmanager describe-secret --secret-id afu9/{env}/admin-subs",
    "",
    "2. Check ECS task execution role has secretsmanager:GetSecretValue permission",
    "",
    "3. Verify the environment variable in running container:",
    "   aws ecs execute-command --cluster afu9-cluster \",
    "     --task {task-id} --container control-center \",
    "     --command 'env | grep AFU9_ADMIN_SUBS'",
    "",
    "4. Check CloudFormation stack for errors:",
    "   aws cloudformation describe-stack-events \",
    "     --stack-name Afu9EcsStageStack",
    "",
    "5. Review ECS service events:",
    "   aws ecs describe-services --cluster afu9-cluster \",
    "     --services afu9-control-center-{env}"
)

foreach ($line in $troubleshooting) {
    if ($line -match "^\d+\.") {
        Write-Host $line -ForegroundColor Yellow
    } elseif ($line -match "^   aws") {
        Write-Host $line -ForegroundColor Cyan
    } else {
        Write-Host $line -ForegroundColor White
    }
}

Write-Host ""

# ============================================================================
# Step 7: Related Documentation
# ============================================================================

Write-Header "Step 7: Related Documentation"

Write-Info "For more information, see:"
Write-Host "  - docs/runbooks/MIGRATION_PARITY_CHECK.md" -ForegroundColor Cyan
Write-Host "  - docs/runbooks/ecs-secret-injection.md" -ForegroundColor Cyan
Write-Host "  - E80_1_IMPLEMENTATION_SUMMARY.md" -ForegroundColor Cyan
Write-Host ""

Write-Success "Helper script complete!"
Write-Info "Follow the steps above to update your ECS task definition"
Write-Host ""

exit 0
