# Deployment Guide - AFU-9 CodeFactory Control

## Voraussetzungen

1. **AWS Account** mit Administrator-Zugriff
2. **Node.js** 18+ und npm
3. **AWS CLI** konfiguriert
4. **GitHub Account** mit Berechtigung zum Erstellen von GitHub Apps

## Schritt-für-Schritt Deployment

### 1. Repository klonen

```bash
git clone https://github.com/adaefler-art/codefactory-control.git
cd codefactory-control
```

### 2. Dependencies installieren

```bash
npm install
```

### 3. GitHub App erstellen

1. Gehe zu GitHub Settings → Developer settings → GitHub Apps → New GitHub App

2. Konfiguriere die App:
   - **Name**: AFU-9 CodeFactory (oder eigener Name)
   - **Homepage URL**: https://github.com/your-org/codefactory-control
   - **Webhook URL**: (wird später aus CDK Output eingetragen)
   - **Webhook Secret**: Generiere ein sicheres Secret

3. Berechtigungen:
   - Repository permissions:
     - Contents: Read & Write
     - Issues: Read & Write
     - Pull requests: Read & Write
     - Checks: Read
     - Metadata: Read
   
4. Events abonnieren:
   - Issues
   - Pull request
   - Check run
   - Check suite

5. Private Key generieren und herunterladen

### 4. GitHub Private Key in AWS Secrets Manager speichern

```bash
# Private Key in Secrets Manager speichern
aws secretsmanager create-secret \
  --name codefactory/github-private-key \
  --description "GitHub App Private Key for AFU-9" \
  --secret-string file://path/to/downloaded-private-key.pem \
  --region us-east-1
```

### 5. Environment Variables konfigurieren

```bash
# .env Datei erstellen
cp .env.example .env

# .env bearbeiten und ausfüllen:
# - AWS_REGION
# - GITHUB_APP_ID (aus GitHub App)
# - GITHUB_WEBHOOK_SECRET
# - GITHUB_INSTALLATION_ID (nach Installation der App)
# - GITHUB_PRIVATE_KEY_SECRET_ARN (aus Schritt 4)
```

### 6. TypeScript kompilieren

```bash
npm run build
```

### 7. CDK Bootstrap (einmalig pro Account/Region)

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

Beispiel:
```bash
cdk bootstrap aws://123456789012/us-east-1
```

### 8. CDK Stack deployen

```bash
# CloudFormation Template generieren (optional)
npm run synth

# Stack deployen
npm run deploy
```

Der Deployment-Prozess dauert ca. 5-10 Minuten.

### 9. Webhook URL in GitHub App konfigurieren

Nach erfolgreichem Deployment:

1. Kopiere die **WebhookURL** aus dem CDK Output
2. Gehe zur GitHub App Settings
3. Trage die Webhook URL ein
4. Speichern

### 10. GitHub App installieren

1. Installiere die GitHub App in den gewünschten Repositories
2. Notiere die **Installation ID** (sichtbar in der URL)
3. Aktualisiere `GITHUB_INSTALLATION_ID` in `.env`

### 11. Deployment verifizieren

```bash
# Lambda Functions prüfen
aws lambda list-functions --region us-east-1 | grep CodeFactory

# Step Function prüfen
aws stepfunctions list-state-machines --region us-east-1

# API Gateway prüfen
aws apigateway get-rest-apis --region us-east-1
```

### 12. Test durchführen

1. Erstelle ein Test-Issue in einem überwachten Repository
2. Prüfe CloudWatch Logs:
   ```bash
   aws logs tail /aws/lambda/WebhookHandler --follow
   ```
3. Überprüfe Step Functions Execution:
   ```bash
   aws stepfunctions list-executions \
     --state-machine-arn <STATE-MACHINE-ARN>
   ```

## Troubleshooting

### Lambda Functions können Secrets nicht lesen

```bash
# IAM-Rolle prüfen
aws iam get-role --role-name CodeFactoryControlStack-LambdaExecutionRole...

# Secret prüfen
aws secretsmanager get-secret-value \
  --secret-id codefactory/github-private-key
```

### Webhook wird nicht getriggert

1. GitHub App Webhook Deliveries prüfen
2. API Gateway Logs aktivieren:
   ```bash
   aws apigateway update-stage \
     --rest-api-id <API-ID> \
     --stage-name prod \
     --patch-operations op=replace,path=/accessLogSettings/destinationArn,value=<LOG-GROUP-ARN>
   ```

### Step Function schlägt fehl

```bash
# Execution Details anzeigen
aws stepfunctions describe-execution \
  --execution-arn <EXECUTION-ARN>

# CloudWatch Logs prüfen
aws logs tail /aws/lambda/<LAMBDA-NAME> --follow
```

## Updates deployen

```bash
# Code ändern
# ...

# Neu kompilieren
npm run build

# Stack aktualisieren
npm run deploy
```

## Stack löschen

```bash
cdk destroy CodeFactoryControlStack
```

**Achtung**: Secrets in Secrets Manager werden nicht automatisch gelöscht!

```bash
# Secrets manuell löschen
aws secretsmanager delete-secret \
  --secret-id codefactory/github-private-key \
  --force-delete-without-recovery
```

## Monitoring

### CloudWatch Dashboards

Erstelle ein Dashboard für Monitoring:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name AFU9-CodeFactory \
  --dashboard-body file://cloudwatch-dashboard.json
```

### Alarme einrichten

```bash
# Alarm für Lambda-Fehler
aws cloudwatch put-metric-alarm \
  --alarm-name CodeFactory-Lambda-Errors \
  --alarm-description "Alert on Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold
```

## Kosten

Geschätzte monatliche Kosten (bei 100 Issues/Monat):

- Lambda: ~$1-5
- Step Functions: ~$0.50-2
- API Gateway: ~$0.10-1
- CloudWatch Logs: ~$0.50-2
- Secrets Manager: ~$0.40

**Gesamt**: ~$2.50-10.40/Monat

## Sicherheit Best Practices

1. ✅ Keine Secrets im Code
2. ✅ IAM-Rollen mit minimalen Berechtigungen
3. ✅ Secrets Manager für sensitive Daten
4. ✅ Webhook-Signatur-Verifizierung
5. ✅ CloudWatch Logs für Audit Trail

## Support

Bei Problemen:
1. CloudWatch Logs prüfen
2. GitHub Issues erstellen
3. AWS Support kontaktieren (bei AWS-spezifischen Problemen)
