import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { AuditRecord } from './types';

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const schemaPath = path.join(__dirname, 'audit.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validateAudit = ajv.compile(schema);

export function writeAuditRecord(record: AuditRecord, filePath: string): void {
  validateOrThrow(record);
  const line = JSON.stringify(record);
  fs.appendFileSync(filePath, line + '\n', { encoding: 'utf8' });
}

function validateOrThrow(doc: AuditRecord): void {
  const ok = validateAudit(doc);
  if (!ok && validateAudit.errors) {
    const message = validateAudit.errors.map(formatAjvError).join('; ');
    throw new Error(`Audit schema validation failed: ${message}`);
  }
}

function formatAjvError(err: ErrorObject<string, Record<string, unknown>, unknown>): string {
  const instancePath = err.instancePath || '(root)';
  const schemaPath = err.schemaPath || '';
  const message = err.message || 'validation error';
  return `${instancePath} ${message} [${schemaPath}]`.trim();
}
