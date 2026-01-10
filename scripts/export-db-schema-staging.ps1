[CmdletBinding()]
param(
	[string]$Cluster = 'afu9-cluster',
	[string]$ServiceName = 'afu9-control-center-staging',
	[string]$Container = 'afu9-control-center',
	[string]$Region = 'eu-central-1',
	[string]$Profile = 'codefactory',
	[string]$OutputDir = 'C:\dev\codefactory\db-schema-export'
)

$ErrorActionPreference = 'Stop'

function Write-Header {
	param([string]$Title)
	Write-Host "" 
	Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Cyan
	Write-Host "║  $Title".PadRight(39) + "║" -ForegroundColor Cyan
	Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Cyan
	Write-Host ""
}

function Get-EcsTaskArn {
	[CmdletBinding()]
	param(
		[string]$Cluster,
		[string]$ServiceName,
		[string]$Region,
		[string]$Profile
	)

	$taskArn = aws ecs list-tasks `
		--cluster $Cluster `
		--service-name $ServiceName `
		--region $Region `
		--profile $Profile `
		--query 'taskArns[0]' `
		--output text

	if (-not $taskArn -or $taskArn -eq 'None') {
		throw "No running ECS task found for service '$ServiceName' in cluster '$Cluster' ($Region)."
	}

	return $taskArn
}

function Invoke-EcsExecToFile {
	[CmdletBinding()]
	param(
		[string]$TaskArn,
		[string]$Container,
		[string]$Cluster,
		[string]$Region,
		[string]$Profile,
		[string]$Command,
		[string]$OutFile
	)

	$null = New-Item -ItemType Directory -Path (Split-Path -Parent $OutFile) -Force
	
	# Note: ECS Exec output includes session headers; we capture stdout+stderr for full fidelity.
	aws ecs execute-command `
		--cluster $Cluster `
		--task $TaskArn `
		--container $Container `
		--region $Region `
		--profile $Profile `
		--command $Command `
		--non-interactive > $OutFile 2>&1

	return $LASTEXITCODE
}

Write-Header 'Complete Database Schema Export'

try {
	$TaskArn = Get-EcsTaskArn -Cluster $Cluster -ServiceName $ServiceName -Region $Region -Profile $Profile
	$taskId = ($TaskArn -split '/')[-1]
	Write-Host "Task:  $taskId" -ForegroundColor Gray
	Write-Host ""

	New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

	# Use sh -lc to guarantee env-var expansion + sane quoting in the container.
	$pgDumpSchemaOnly = 'sh -lc ''pg_dump -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" --schema-only'''
	$psqlListTables   = 'sh -lc ''psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -c "\\dt"'''
	$psqlDescribeMig  = 'sh -lc ''psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -c "\\d schema_migrations"'''
	$psqlAllMigIds     = 'sh -lc ''psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -t -c "SELECT migration_id FROM schema_migrations ORDER BY migration_id;"'''
	$psqlMigStats     = 'sh -lc ''psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -c "SELECT COUNT(*) as total, MIN(migration_id) as first, MAX(migration_id) as last FROM schema_migrations;"'''
	$pgDumpMigData    = 'sh -lc ''pg_dump -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" --table=schema_migrations --data-only --inserts'''

	# 1) COMPLETE SCHEMA DUMP (structure only)
	Write-Host '1.  Exporting complete schema structure...' -ForegroundColor Yellow
	Write-Host ''
	$SchemaFile = Join-Path $OutputDir 'schema_structure.sql'
	$exit = Invoke-EcsExecToFile -TaskArn $TaskArn -Container $Container -Cluster $Cluster -Region $Region -Profile $Profile -Command $pgDumpSchemaOnly -OutFile $SchemaFile
	if ($exit -eq 0) {
		Write-Host "✅ Schema structure exported to:  $SchemaFile" -ForegroundColor Green
		Write-Host "   Size: $([Math]::Round((Get-Item $SchemaFile).Length / 1KB, 2)) KB" -ForegroundColor Gray
	} else {
		Write-Host "⚠️  Schema export may have issues (exit $exit)" -ForegroundColor Yellow
	}
	Write-Host ''

	# 2) LIST ALL TABLES
	Write-Host '2. Listing all tables...' -ForegroundColor Yellow
	Write-Host ''
	$TablesFile = Join-Path $OutputDir 'all_tables.txt'
	$exit = Invoke-EcsExecToFile -TaskArn $TaskArn -Container $Container -Cluster $Cluster -Region $Region -Profile $Profile -Command $psqlListTables -OutFile $TablesFile
	if ($exit -eq 0) {
		Write-Host "✅ Tables list:  $TablesFile" -ForegroundColor Green
		Get-Content $TablesFile | Select-Object -First 30
	} else {
		Write-Host "⚠️  Tables listing may have issues (exit $exit)" -ForegroundColor Yellow
		Get-Content $TablesFile | Select-Object -First 50
	}
	Write-Host ''

	# 3) schema_migrations table structure
	Write-Host '3. schema_migrations table structure...' -ForegroundColor Yellow
	Write-Host ''
	$MigTableFile = Join-Path $OutputDir 'schema_migrations_structure.txt'
	$exit = Invoke-EcsExecToFile -TaskArn $TaskArn -Container $Container -Cluster $Cluster -Region $Region -Profile $Profile -Command $psqlDescribeMig -OutFile $MigTableFile
	Write-Host "✅ Table structure: $MigTableFile" -ForegroundColor Green
	Get-Content $MigTableFile
	Write-Host ''

	# 4) ALL MIGRATION IDs (sorted)
	Write-Host '4. All migration_id values...' -ForegroundColor Yellow
	Write-Host ''
	$MigrationsFile = Join-Path $OutputDir 'all_migrations.txt'
	$exit = Invoke-EcsExecToFile -TaskArn $TaskArn -Container $Container -Cluster $Cluster -Region $Region -Profile $Profile -Command $psqlAllMigIds -OutFile $MigrationsFile
	Write-Host "✅ All migrations: $MigrationsFile" -ForegroundColor Green
	$MigrationContent = Get-Content $MigrationsFile | Where-Object { $_.Trim() -ne '' }
	Write-Host "   Total: $($MigrationContent.Count) migrations" -ForegroundColor Cyan
	Write-Host ''
	Write-Host 'First 10:' -ForegroundColor Gray
	$MigrationContent | Select-Object -First 10 | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }
	Write-Host ''
	Write-Host 'Last 10:' -ForegroundColor Gray
	$MigrationContent | Select-Object -Last 10 | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }
	Write-Host ''

	# 5) MIGRATION STATISTICS
	Write-Host '5. Migration statistics...' -ForegroundColor Yellow
	Write-Host ''
	$StatsFile = Join-Path $OutputDir 'migration_stats.txt'
	$exit = Invoke-EcsExecToFile -TaskArn $TaskArn -Container $Container -Cluster $Cluster -Region $Region -Profile $Profile -Command $psqlMigStats -OutFile $StatsFile
	Write-Host "✅ Statistics: $StatsFile" -ForegroundColor Green
	Get-Content $StatsFile
	Write-Host ''

	# 6) FULL DATA DUMP (schema_migrations only)
	Write-Host '6. Complete schema_migrations data dump...' -ForegroundColor Yellow
	Write-Host ''
	$DataDumpFile = Join-Path $OutputDir 'schema_migrations_data.sql'
	$exit = Invoke-EcsExecToFile -TaskArn $TaskArn -Container $Container -Cluster $Cluster -Region $Region -Profile $Profile -Command $pgDumpMigData -OutFile $DataDumpFile
	Write-Host "✅ Data dump: $DataDumpFile" -ForegroundColor Green
	Write-Host "   Size: $([Math]::Round((Get-Item $DataDumpFile).Length / 1KB, 2)) KB" -ForegroundColor Gray
	Write-Host ''

	Write-Host ''
	Write-Host '╔═══════════════════════════════════════╗' -ForegroundColor Green
	Write-Host '║  ✅ EXPORT COMPLETE!    ✅              ║' -ForegroundColor Green
	Write-Host '╚═══════════════════════════════════════╝' -ForegroundColor Green
	Write-Host ''
	Write-Host "📁 Export location: $OutputDir" -ForegroundColor Cyan
	Write-Host ''
	Write-Host 'Files created:' -ForegroundColor White
	Write-Host '  1. schema_structure.sql            - Complete DB schema' -ForegroundColor Gray
	Write-Host '  2. all_tables.txt                  - List of all tables' -ForegroundColor Gray
	Write-Host '  3. schema_migrations_structure.txt - Migration table structure' -ForegroundColor Gray
	Write-Host '  4. all_migrations.txt              - All migration IDs' -ForegroundColor Gray
	Write-Host '  5. migration_stats.txt             - Statistics' -ForegroundColor Gray
	Write-Host '  6. schema_migrations_data.sql       - Full data as SQL inserts' -ForegroundColor Gray
	Write-Host ''

	explorer $OutputDir | Out-Null
}
catch {
	Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
	throw
}
