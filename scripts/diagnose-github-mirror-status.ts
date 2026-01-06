#!/usr/bin/env ts-node

/**
 * GitHub Mirror Status Diagnose-Skript
 * 
 * Automatische 3-Schritt-Diagnose für Issue #624
 * 
 * Usage:
 *   npm run ts-node scripts/diagnose-github-mirror-status.ts
 *   npm run ts-node scripts/diagnose-github-mirror-status.ts -- --verbose
 *   npm run ts-node scripts/diagnose-github-mirror-status.ts -- --skip-sync
 */

import { Pool } from 'pg';
import chalk from 'chalk';

// CLI Flags
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const SKIP_SYNC = args.includes('--skip-sync');

interface DiagnosticResult {
  issueI691Found: boolean;
  issueI691Status: string | null;
  issueI691LastSync: Date | null;
  totalIssuesWithGitHub: number;
  statusDistribution: { status: string; count: number }[];
  neverSyncedCount: number;
  lastSyncTime: Date | null;
  syncedIssuesCount: number;
  syncEndpointOk: boolean;
  syncResponse: any;
}

const diagnosticResult: Partial<DiagnosticResult> = {};

async function main() {
  console.log(chalk.cyan('╔═══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║  GitHub Mirror Status Diagnose                                ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════════════════════════╝\n'));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(chalk.red('❌ DATABASE_URL environment variable not set'));
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Schritt 1: DB-Analyse
    await analyzeDatabaseState(pool);

    // Schritt 2: Sync-Test
    if (!SKIP_SYNC) {
      await testSyncEndpoint();
    } else {
      console.log(chalk.yellow('\n⚠️  Skipping sync endpoint test (--skip-sync flag)'));
    }

    // Schritt 3: Diagnose
    await provideDiagnosis();

  } catch (error) {
    console.error(chalk.red('\n❌ Diagnostic script failed:'));
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function analyzeDatabaseState(pool: Pool) {
  console.log(chalk.blue('\n[1/3] Datenbank-Analyse'));
  console.log(chalk.gray('━'.repeat(63)));

  // Query 1: Prüfe das Beispiel-Issue I691
  console.log(chalk.cyan('\n📊 Query 1: Issue I691 (GitHub #477)'));
  const query1 = `
    SELECT 
      id,
      LEFT(id::text, 8) as public_id,
      title,
      github_issue_number,
      github_mirror_status,
      github_url,
      github_repo,
      handoff_state,
      github_issue_last_sync_at
    FROM afu9_issues
    WHERE title LIKE '%I691%' OR github_issue_number = 477;
  `;

  if (VERBOSE) {
    console.log(chalk.gray('SQL:'), query1);
  }

  const result1 = await pool.query(query1);
  
  if (result1.rows.length === 0) {
    console.log(chalk.yellow('⚠️  Issue I691 nicht gefunden'));
    diagnosticResult.issueI691Found = false;
  } else {
    const issue = result1.rows[0];
    diagnosticResult.issueI691Found = true;
    diagnosticResult.issueI691Status = issue.github_mirror_status;
    diagnosticResult.issueI691LastSync = issue.github_issue_last_sync_at;

    console.log(chalk.white('┌─────────────────────────────────────────────────────────────┐'));
    console.log(chalk.white(`│ public_id: ${issue.public_id}`.padEnd(62) + '│'));
    console.log(chalk.white(`│ title: ${issue.title?.substring(0, 45) || 'N/A'}...`.padEnd(62) + '│'));
    console.log(chalk.white(`│ github_issue_number: ${issue.github_issue_number}`.padEnd(62) + '│'));
    
    const statusIcon = issue.github_mirror_status === 'UNKNOWN' ? '❌' : '✅';
    const statusColor = issue.github_mirror_status === 'UNKNOWN' ? chalk.red : chalk.green;
    console.log(chalk.white(`│ github_mirror_status: ${statusColor(issue.github_mirror_status)} ${statusIcon}`.padEnd(72) + '│'));
    
    console.log(chalk.white(`│ github_url: ${issue.github_url?.substring(0, 40) || 'N/A'}...`.padEnd(62) + '│'));
    console.log(chalk.white(`│ handoff_state: ${issue.handoff_state}`.padEnd(62) + '│'));
    
    const syncIcon = issue.github_issue_last_sync_at ? '✅' : '⚠️';
    const syncColor = issue.github_issue_last_sync_at ? chalk.green : chalk.yellow;
    const syncValue = issue.github_issue_last_sync_at || 'NULL';
    console.log(chalk.white(`│ github_issue_last_sync_at: ${syncColor(syncValue)} ${syncIcon}`.padEnd(72) + '│'));
    
    console.log(chalk.white('└─────────────────────────────────────────────────────────────┘'));
  }

  // Query 2: Statistik über alle Issues mit GitHub-Link
  console.log(chalk.cyan('\n📊 Query 2: GitHub Mirror Status Verteilung'));
  const query2 = `
    SELECT 
      github_mirror_status,
      COUNT(*) as count
    FROM afu9_issues
    WHERE github_issue_number IS NOT NULL
    GROUP BY github_mirror_status
    ORDER BY count DESC;
  `;

  if (VERBOSE) {
    console.log(chalk.gray('SQL:'), query2);
  }

  const result2 = await pool.query(query2);
  diagnosticResult.statusDistribution = result2.rows.map(row => ({
    status: row.github_mirror_status,
    count: parseInt(row.count)
  }));

  diagnosticResult.totalIssuesWithGitHub = diagnosticResult.statusDistribution.reduce((sum, item) => sum + item.count, 0);

  console.log(chalk.white('┌─────────────────────────────────────────────────────────────┐'));
  for (const row of result2.rows) {
    const statusIcon = row.github_mirror_status === 'UNKNOWN' ? '❌' : 
                       row.github_mirror_status === 'OPEN' ? '🟢' :
                       row.github_mirror_status === 'CLOSED' ? '🔴' : '⚠️';
    console.log(chalk.white(`│ ${statusIcon} ${(row.github_mirror_status || 'NULL').padEnd(10)} : ${row.count}`.padEnd(62) + '│'));
  }
  console.log(chalk.white(`│ ${'─'.repeat(59)} │`));
  console.log(chalk.white(`│ Total: ${diagnosticResult.totalIssuesWithGitHub}`.padEnd(62) + '│'));
  console.log(chalk.white('└─────────────────────────────────────────────────────────────┘'));

  // Query 3: Issues, die niemals gesynct wurden
  console.log(chalk.cyan('\n📊 Query 3: Issues ohne Sync'));
  const query3 = `
    SELECT 
      COUNT(*) as never_synced_count
    FROM afu9_issues
    WHERE github_issue_number IS NOT NULL
      AND github_issue_last_sync_at IS NULL;
  `;

  if (VERBOSE) {
    console.log(chalk.gray('SQL:'), query3);
  }

  const result3 = await pool.query(query3);
  diagnosticResult.neverSyncedCount = parseInt(result3.rows[0].never_synced_count);

  const neverSyncedIcon = diagnosticResult.neverSyncedCount > 0 ? '⚠️' : '✅';
  const neverSyncedColor = diagnosticResult.neverSyncedCount > 0 ? chalk.yellow : chalk.green;
  console.log(neverSyncedColor(`${neverSyncedIcon} ${diagnosticResult.neverSyncedCount} Issues wurden niemals gesynct`));

  // Query 4: Letzter erfolgreicher Sync
  console.log(chalk.cyan('\n📊 Query 4: Letzter erfolgreicher Sync'));
  const query4 = `
    SELECT 
      MAX(github_issue_last_sync_at) as last_sync_time,
      COUNT(*) as synced_issues_count
    FROM afu9_issues
    WHERE github_issue_last_sync_at IS NOT NULL;
  `;

  if (VERBOSE) {
    console.log(chalk.gray('SQL:'), query4);
  }

  const result4 = await pool.query(query4);
  diagnosticResult.lastSyncTime = result4.rows[0].last_sync_time;
  diagnosticResult.syncedIssuesCount = parseInt(result4.rows[0].synced_issues_count);

  if (diagnosticResult.lastSyncTime) {
    console.log(chalk.green(`✅ Letzter Sync: ${diagnosticResult.lastSyncTime}`));
    console.log(chalk.green(`✅ Gesyncte Issues: ${diagnosticResult.syncedIssuesCount}`));
  } else {
    console.log(chalk.red('❌ Keine erfolgreichen Syncs gefunden'));
  }
}

async function testSyncEndpoint() {
  console.log(chalk.blue('\n[2/3] Sync-Endpoint Test'));
  console.log(chalk.gray('━'.repeat(63)));

  const syncUrl = process.env.SYNC_URL || 'http://localhost:3000/api/ops/issues/sync';
  console.log(chalk.gray(`🔗 URL: ${syncUrl}`));

  try {
    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'x-afu9-sub': 'diagnostic-script',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(chalk.red(`❌ HTTP ${response.status}: ${response.statusText}`));
      diagnosticResult.syncEndpointOk = false;
      diagnosticResult.syncResponse = { error: `HTTP ${response.status}` };
      return;
    }

    const syncResult = await response.json();
    diagnosticResult.syncEndpointOk = true;
    diagnosticResult.syncResponse = syncResult;

    console.log(chalk.white('\n🔄 Sync Response:'));
    console.log(chalk.white('┌─────────────────────────────────────────────────────────────┐'));

    // statusFetchOk
    const fetchIcon = (syncResult.statusFetchOk || 0) > 0 ? '✅' : '❌';
    const fetchColor = (syncResult.statusFetchOk || 0) > 0 ? chalk.green : chalk.red;
    console.log(chalk.white(`│ statusFetchOk: ${fetchColor(syncResult.statusFetchOk || 0)} ${fetchIcon}`.padEnd(72) + '│'));

    // statusPersistOk
    const persistOkIcon = (syncResult.statusPersistOk || 0) > 0 ? '✅' : '❌';
    const persistOkColor = (syncResult.statusPersistOk || 0) > 0 ? chalk.green : chalk.red;
    console.log(chalk.white(`│ statusPersistOk: ${persistOkColor(syncResult.statusPersistOk || 0)} ${persistOkIcon}`.padEnd(72) + '│'));

    // statusPersistFailed
    const persistFailIcon = (syncResult.statusPersistFailed || 0) === 0 ? '✅' : '❌';
    const persistFailColor = (syncResult.statusPersistFailed || 0) === 0 ? chalk.green : chalk.red;
    console.log(chalk.white(`│ statusPersistFailed: ${persistFailColor(syncResult.statusPersistFailed || 0)} ${persistFailIcon}`.padEnd(72) + '│'));

    // statusSynced
    const syncedIcon = (syncResult.statusSynced || 0) > 0 ? '✅' : '⚠️';
    const syncedColor = (syncResult.statusSynced || 0) > 0 ? chalk.green : chalk.yellow;
    console.log(chalk.white(`│ statusSynced: ${syncedColor(syncResult.statusSynced || 0)} ${syncedIcon}`.padEnd(72) + '│'));

    console.log(chalk.white('└─────────────────────────────────────────────────────────────┘'));

    if (VERBOSE) {
      console.log(chalk.gray('\nFull Response:'));
      console.log(JSON.stringify(syncResult, null, 2));
    }

  } catch (error: any) {
    console.error(chalk.red('❌ Sync-Endpoint Fehler:'));
    console.error(chalk.red(error.message));
    diagnosticResult.syncEndpointOk = false;
    diagnosticResult.syncResponse = { error: error.message };
  }
}

async function provideDiagnosis() {
  console.log(chalk.blue('\n[3/3] Diagnose-Ergebnis'));
  console.log(chalk.gray('━'.repeat(63)));

  const problems: string[] = [];
  const warnings: string[] = [];
  const successes: string[] = [];

  // Analyse der Ergebnisse
  if (diagnosticResult.issueI691Found && diagnosticResult.issueI691Status === 'UNKNOWN') {
    problems.push('Issue I691 hat Status UNKNOWN trotz GitHub-Link');
  }

  if (diagnosticResult.issueI691Found && !diagnosticResult.issueI691LastSync) {
    problems.push('Issue I691 wurde niemals gesynct (github_issue_last_sync_at = NULL)');
  }

  if ((diagnosticResult.neverSyncedCount || 0) > 0) {
    warnings.push(`${diagnosticResult.neverSyncedCount} Issues mit GitHub-Link wurden nie gesynct`);
  }

  if (!SKIP_SYNC && diagnosticResult.syncResponse) {
    const fetchOk = diagnosticResult.syncResponse.statusFetchOk || 0;
    const persistOk = diagnosticResult.syncResponse.statusPersistOk || 0;
    const persistFailed = diagnosticResult.syncResponse.statusPersistFailed || 0;

    if (fetchOk > 0 && persistFailed > 0 && persistOk === 0) {
      problems.push('Sync fetch funktioniert, aber alle Persist-Versuche schlagen fehl');
      problems.push(`${persistFailed} Issues konnten nicht persistiert werden`);
    }

    if (fetchOk > 0 && persistOk > 0) {
      successes.push(`${persistOk} Issues erfolgreich gesynct`);
    }

    if (fetchOk === 0) {
      warnings.push('Keine Issues vom GitHub-API gefetcht');
    }
  }

  if (!diagnosticResult.lastSyncTime && (diagnosticResult.totalIssuesWithGitHub || 0) > 0) {
    problems.push('Keine erfolgreichen Syncs trotz GitHub-Issues in der DB');
  }

  // Ausgabe der Diagnose
  if (problems.length > 0) {
    console.log(chalk.red('\n🔴 PROBLEME GEFUNDEN:\n'));
    problems.forEach((problem, idx) => {
      console.log(chalk.red(`  ${idx + 1}. ❌ ${problem}`));
    });
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow('\n⚠️  WARNUNGEN:\n'));
    warnings.forEach((warning, idx) => {
      console.log(chalk.yellow(`  ${idx + 1}. ⚠️  ${warning}`));
    });
  }

  if (successes.length > 0) {
    console.log(chalk.green('\n✅ ERFOLGE:\n'));
    successes.forEach((success, idx) => {
      console.log(chalk.green(`  ${idx + 1}. ✅ ${success}`));
    });
  }

  // Mögliche Ursachen
  if (problems.length > 0) {
    console.log(chalk.yellow('\n💡 MÖGLICHE URSACHEN:\n'));

    if (!SKIP_SYNC && diagnosticResult.syncResponse?.statusPersistFailed > 0) {
      console.log(chalk.yellow('  1. ❌ TypeScript-Type-Casting umgeht Compile-Zeit-Checks'));
      console.log(chalk.yellow('     → Prüfe: Record<string, unknown> vs. Partial<Afu9IssueInput>'));
      console.log(chalk.yellow('     → Prüfe: "as any" Casts in updateAfu9Issue Calls'));
      console.log(chalk.yellow('  2. ❌ CHECK Constraint noch nicht aktualisiert'));
      console.log(chalk.yellow('     → Verifiziere Migration 049 wurde angewendet'));
      console.log(chalk.yellow('  3. ❌ RLS Permissions blockieren Write'));
      console.log(chalk.yellow('     → Prüfe ob Service Role verwendet wird'));
    } else {
      console.log(chalk.yellow('  1. ⚠️  GitHub API Rate Limit erreicht'));
      console.log(chalk.yellow('  2. ⚠️  Sync läuft nicht automatisch'));
      console.log(chalk.yellow('  3. ⚠️  Keine GitHub-Issues vorhanden'));
    }
  }

  // Nächste Schritte
  console.log(chalk.cyan('\n🔧 NÄCHSTE SCHRITTE:\n'));

  if (problems.length > 0) {
    if (!SKIP_SYNC && diagnosticResult.syncResponse?.statusPersistFailed > 0) {
      console.log(chalk.cyan('  → Prüfe Server-Logs nach "Persist failed" Fehlern'));
      console.log(chalk.cyan('  → Untersuche control-center/app/api/ops/issues/sync/route.ts'));
      console.log(chalk.cyan('  → Verifiziere Type-Safety in persistPayload'));
      console.log(chalk.cyan('  → Führe aus: psql -c "\\d afu9_issues" | grep github_mirror_status'));
    } else {
      console.log(chalk.cyan('  → Verifiziere Migration 049 wurde angewendet'));
      console.log(chalk.cyan('  → Prüfe RLS Policies auf afu9_issues Tabelle'));
      console.log(chalk.cyan('  → Teste manuellen Sync-Aufruf mit korrekten Credentials'));
    }
  } else {
    console.log(chalk.green('  → Alles funktioniert wie erwartet! 🎉'));
  }

  // Zusammenfassung
  console.log(chalk.blue('\n╔═══════════════════════════════════════════════════════════════╗'));
  if (problems.length === 0) {
    console.log(chalk.green('║  ✅ STATUS: ALLES OK                                          ║'));
  } else {
    console.log(chalk.red('║  ❌ STATUS: PROBLEM GEFUNDEN                                  ║'));
  }
  console.log(chalk.blue('╚═══════════════════════════════════════════════════════════════╝\n'));
}

main().catch((error) => {
  console.error(chalk.red('\n💥 Unerwarteter Fehler:'));
  console.error(error);
  process.exit(1);
});
