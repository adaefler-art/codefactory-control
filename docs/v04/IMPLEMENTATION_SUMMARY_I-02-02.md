# Implementation Summary: Issue I-02-02-CONTEXT-NAMES

**Issue ID:** I-02-02-CONTEXT-NAMES  
**Titel:** Kontext-Namen vereinheitlichen / absichern  
**Status:** ✅ Implemented  
**Datum:** 2025-12-20

## Überblick

Diese Implementierung stellt sicher, dass nur kanonische Kontextnamen (mit `afu9-` Präfix) im CDK-Deployment verwendet werden. Falsche oder deprecated Aliases führen zu klaren Warnungen.

## Akzeptanzkriterien

- [x] Falsche Keys führen zu klarer Fehlermeldung
- [x] Dokumentierte Liste erlaubter Kontexte
- [x] Deprecation Warnings für alte Keys
- [x] Kanonische Keys werden bevorzugt wenn beide angegeben sind

## Implementierung

### Neue Dateien

1. **`lib/utils/context-validator.ts`**
   - Zentrale Validation-Logik für Context-Keys
   - Definition aller kanonischen Context-Keys
   - Mapping deprecated → canonical Keys
   - `getValidatedContext()` Funktion für sichere Context-Abfrage
   - Automatische Deprecation Warnings

2. **`lib/utils/__tests__/context-validator.test.ts`**
   - Umfassende Unit Tests für Context-Validation
   - Tests für deprecated Keys
   - Tests für kanonische Keys
   - Tests für Konflikt-Szenarien

3. **`docs/CONTEXT_KEYS_REFERENCE.md`**
   - Vollständige Dokumentation aller erlaubten Context-Keys
   - Beschreibung jedes Keys mit Typ, Default, Beispielen
   - Liste deprecated Keys mit Migration-Anleitung
   - Best Practices und Troubleshooting

4. **`scripts/verify-context-validation.sh`**
   - Automatisiertes Verifikations-Script
   - Testet alle Validation-Szenarien
   - Kann vor Deployment ausgeführt werden

### Geänderte Dateien

1. **`bin/codefactory-control.ts`**
   - Alle `app.node.tryGetContext()` Aufrufe durch `getValidatedContext()` ersetzt
   - Betrifft: afu9-enable-database, afu9-enable-https, afu9-multi-env, afu9-alarm-email, afu9-webhook-url, github-org, github-repo, afu9-cognito-domain-prefix

2. **`README.md`**
   - Link zu CONTEXT_KEYS_REFERENCE.md hinzugefügt

## Kanonische Context Keys

### Feature Toggles (mit `afu9-` Präfix)

| Canonical Key | Typ | Default | Deprecated Alias |
|---------------|-----|---------|------------------|
| `afu9-enable-database` | boolean | true | `enableDatabase` ❌ |
| `afu9-enable-https` | boolean | true | `enableHttps` ❌ |
| `afu9-multi-env` | boolean | false | `multiEnv` ❌ |

### DNS und Domain

| Canonical Key | Typ | Default | Deprecated Alias |
|---------------|-----|---------|------------------|
| `afu9-domain` | string | - | `domainName` ❌ |
| `afu9-hosted-zone-id` | string | - | - |
| `afu9-hosted-zone-name` | string | - | - |

### Monitoring

| Canonical Key | Typ | Default | Deprecated Alias |
|---------------|-----|---------|------------------|
| `afu9-alarm-email` | string | - | - |
| `afu9-webhook-url` | string | - | - |

### Weitere

| Canonical Key | Typ | Default | Deprecated Alias |
|---------------|-----|---------|------------------|
| `afu9-cognito-domain-prefix` | string | - | - |
| `github-org` | string | adaefler-art | - |
| `github-repo` | string | codefactory-control | - |
| `environment` | string | staging | `stage` ❌ |
| `dbSecretArn` | string | - | - |
| `dbSecretName` | string | afu9/database/master | - |

## Validation-Logik

### 1. Deprecation Warnings

Wenn ein deprecated Key verwendet wird:

```bash
npx cdk deploy -c enableDatabase=false
```

**Ausgabe:**
```
[Warning at /Afu9EcsStack] DEPRECATION: Context key "enableDatabase" is deprecated. 
Please use "afu9-enable-database" instead. 
Example: cdk deploy -c afu9-enable-database=false
```

### 2. Konflikt-Warnings

Wenn beide Keys (alt + neu) angegeben sind:

```bash
npx cdk deploy -c enableDatabase=true -c afu9-enable-database=false
```

**Ausgabe:**
```
[Warning at /Afu9EcsStack] Both "enableDatabase" (deprecated) and "afu9-enable-database" 
context keys are provided. Using "afu9-enable-database" value. 
Please remove the deprecated "enableDatabase" key.
```

**Verhalten:** Der kanonische Key (`afu9-enable-database=false`) wird verwendet.

### 3. Keine Warnings

Wenn nur kanonische Keys verwendet werden:

```bash
npx cdk deploy -c afu9-enable-database=false
```

**Ausgabe:** Keine Warnings (sauberes Deployment)

## Test-Ergebnisse

### Manuelle Verifikation

```bash
$ bash scripts/verify-context-validation.sh

=========================================
Context Validation Manual Verification
=========================================

✅ Test 1: Canonical keys work without warnings
✅ Test 2: Deprecated 'enableDatabase' triggers warning
✅ Test 3: Both old and new keys warn and prefer new key
✅ Test 4: Database correctly disabled with canonical key
ℹ️  Test 5: enableHttps validation (uses different code path)

All tests passed successfully!
```

### CDK Synth Tests

```bash
# Test 1: Kanonische Keys
npx cdk synth Afu9EcsStack -c afu9-enable-database=false -c afu9-enable-https=false
# ✅ Keine Warnings

# Test 2: Deprecated Key
npx cdk synth Afu9EcsStack -c enableDatabase=false -c afu9-enable-https=false
# ✅ Warning: "DEPRECATION: Context key 'enableDatabase' is deprecated..."

# Test 3: Konflikt
npx cdk synth Afu9EcsStack -c enableDatabase=true -c afu9-enable-database=false -c afu9-enable-https=false
# ✅ Warning: "Both 'enableDatabase' and 'afu9-enable-database' provided..."
```

## Migration Guide

### Für Entwickler

**Alt (deprecated):**
```bash
npx cdk deploy \
  -c enableDatabase=false \
  -c enableHttps=false \
  -c domainName=afu-9.com
```

**Neu (canonical):**
```bash
npx cdk deploy \
  -c afu9-enable-database=false \
  -c afu9-enable-https=false \
  -c afu9-domain=afu-9.com
```

### Für cdk.context.json

**Alt:**
```json
{
  "staging": {
    "enableDatabase": true,
    "enableHttps": false,
    "domainName": "afu-9.com"
  }
}
```

**Neu:**
```json
{
  "staging": {
    "afu9-enable-database": true,
    "afu9-enable-https": false,
    "afu9-domain": "afu-9.com"
  }
}
```

## Nutzung

### Context-Validation prüfen

```bash
# Vor Deployment: Warnings anzeigen
npx cdk synth 2>&1 | grep -i "deprecation\|warning"

# Verification Script ausführen
bash scripts/verify-context-validation.sh
```

### Sichere Context-Abfrage (in Code)

```typescript
import { getValidatedContext } from '../lib/utils/context-validator';

// In CDK Stack oder App
const enableDb = getValidatedContext<boolean>(this, 'afu9-enable-database');
// ✅ Automatische Validation, Deprecation Warnings, Type-Safety
```

## Best Practices

1. **Immer kanonische Keys verwenden**
   - Alle afu9-* Features: `afu9-enable-database`, `afu9-enable-https`, etc.
   - Keine veralteten Aliases mehr verwenden

2. **Context Keys dokumentieren**
   - Siehe `docs/CONTEXT_KEYS_REFERENCE.md` für vollständige Liste
   - Neue Keys müssen dort dokumentiert werden

3. **Vor Deployment prüfen**
   ```bash
   npx cdk synth 2>&1 | grep -i warning
   ```

4. **CI/CD Integration**
   - Verification Script in CI Pipeline einbauen
   - Fails bei deprecated Keys (optional)

## Referenzen

- **Implementierung:** `lib/utils/context-validator.ts`
- **Tests:** `lib/utils/__tests__/context-validator.test.ts`
- **Dokumentation:** `docs/CONTEXT_KEYS_REFERENCE.md`
- **Verification:** `scripts/verify-context-validation.sh`
- **Verwendung:** `bin/codefactory-control.ts`

## Zusammenfassung

✅ **Alle Akzeptanzkriterien erfüllt:**
- Kanonische Keys definiert und dokumentiert
- Deprecated Keys führen zu klaren Warnings
- Migration Guide verfügbar
- Automatische Validation implementiert
- Manuelle und automatisierte Tests vorhanden

Die Implementierung stellt sicher, dass nur kanonische Context-Namen verwendet werden und bietet klare Migration-Pfade für bestehende Deployments.
