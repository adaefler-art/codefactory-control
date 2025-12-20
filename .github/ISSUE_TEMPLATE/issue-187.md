**ID:** I-03-01-DIFF-GATE

**Beschreibung:**
Definiere einen verbindlichen Diff-Gate: Deploy darf nur erfolgen, wenn der Diff keine unerwarteten Änderungen (ECS Replacement, DNS/ACM) enthält.

**Akzeptanzkriterien:**
- Klare Kriterien: was blockiert Deploy
- Dokumentiert im Deploy-Runbook
- Copilot-/CI-tauglich

**CDK Synth Validation Gate:**

### Implementation-Plan:
1. **Pre-Deploy Script** (`scripts/validate-cdk-diff.ts`):
   ```typescript
   // Führt `cdk diff` aus und parsed das Output
   // Blockiert bei kritischen Änderungen:
   // - ECS Service Replacement
   // - TaskDefinition mit breaking changes
   // - DNS/ACM Modifikationen
   // - Security Group Deletions
   ```

2. **GitHub Actions Integration** (`.github/workflows/deploy.yml`):
   ```yaml
   - name: CDK Diff Gate
     run: npm run validate:diff
     env:
       STAGE: ${{ matrix.stage }}
   ```

3. **Diff-Parser Logik:**
   - Regex-basierte Erkennung kritischer Ressourcen-Änderungen
   - Exit-Code 1 bei blockierenden Änderungen
   - Strukturiertes JSON-Output für CI/CD-Logs

4. **Dokumentation:**
   - `docs/deployment-runbook.md` - Diff-Gate Prozess
   - `docs/diff-gate-rules.md` - Vollständige Regelwerk

### Blockierende Änderungen:
- `[~] AWS::ECS::Service` (Replacement)
- `[-] AWS::CertificateManager::Certificate`
- `[-] AWS::Route53::RecordSet`
- `[~] AWS::EC2::SecurityGroup` (Rules Deletion)

### Erlaubte Änderungen:
- `[~] AWS::ECS::TaskDefinition` (Image Update)
- `[+]` Neue Ressourcen (non-destructive)
