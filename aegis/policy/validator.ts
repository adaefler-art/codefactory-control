import Ajv, { ErrorObject } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';
import { PolicyDocument } from './types';

const ALLOWED_IDENTIFIERS = new Set([
  'ci.status',
  'security.critical_count',
  'security.high_count',
  'change_flags.infra_change',
  'change_flags.db_migration',
  'change_flags.auth_change',
  'change_flags.secrets_change',
  'change_flags.dependency_change',
  'canary.error_rate',
  'canary.latency_delta',
]);

export class PolicyValidationError extends Error {
  constructor(message: string, public readonly details: string[]) {
    super(message);
    this.name = 'PolicyValidationError';
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const schemaPath = path.join(__dirname, 'schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

export function validatePolicy(doc: PolicyDocument): void {
  const ok = validate(doc);
  const errors: string[] = [];

  if (!ok && validate.errors) {
    errors.push(...validate.errors.map((e) => formatAjvError(e)));
  }

  // Additional guard: ensure all identifiers in "when" are known before evaluation
  if (doc.rules && Array.isArray(doc.rules)) {
    doc.rules.forEach((rule, idx) => {
      const prefix = rule?.id ? `rule ${rule.id}` : `rules[${idx}]`;
      const identifiers = extractIdentifiers(rule.when);
      identifiers.forEach((id) => {
        if (!ALLOWED_IDENTIFIERS.has(id)) {
          errors.push(`${prefix}: unknown identifier in when: ${id}`);
        }
      });
    });
  }

  if (errors.length > 0) {
    throw new PolicyValidationError('Policy validation failed', errors);
  }
}

function formatAjvError(err: ErrorObject<string, Record<string, unknown>, unknown>): string {
  const instancePath = err.instancePath || '(root)';
  const schemaPath = err.schemaPath || '';
  const message = err.message || 'validation error';
  return `${instancePath} ${message} [${schemaPath}]`.trim();
}

function extractIdentifiers(expr: unknown): string[] {
  if (typeof expr !== 'string') return [];
  const ids: string[] = [];
  const withoutStrings = expr.replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  const re = /([A-Za-z_][A-Za-z0-9_.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutStrings)) !== null) {
    const candidate = m[1];
    // Skip logical operators spelled out or boolean literals captured by regex
    if (candidate === 'true' || candidate === 'false') continue;
    if (candidate === 'and' || candidate === 'or') continue;
    // Only collect identifiers that contain a dot (namespaced fields)
    if (candidate.includes('.')) {
      ids.push(candidate);
    }
  }
  return ids;
}
