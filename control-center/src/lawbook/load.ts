import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import type {
  GuardrailsFile,
  ParametersFile,
  MemorySeedFile,
  LoadedLawbook,
  Guardrail,
  LawbookParameter,
  MemorySeedEntry,
  LawbookCategory,
  LawbookEnforcement,
  LawbookScope,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  );
}

function isScope(value: unknown): value is LawbookScope {
  return (
    value === 'global' ||
    value === 'api' ||
    value === 'ui' ||
    value === 'issues' ||
    value === 'workflows' ||
    value === 'deploy' ||
    value === 'observability'
  );
}

function isCategory(value: unknown): value is LawbookCategory {
  return (
    value === 'safety' ||
    value === 'security' ||
    value === 'reliability' ||
    value === 'quality' ||
    value === 'compliance' ||
    value === 'performance' ||
    value === 'cost' ||
    value === 'product' ||
    value === 'observability'
  );
}

function isEnforcement(value: unknown): value is LawbookEnforcement {
  return value === 'hard' || value === 'soft' || value === 'advisory';
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null) return null;
    if (typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(normalize);

    if (seen.has(v)) throw new Error('Cannot stableStringify cyclic structure');
    seen.add(v);

    const keys = Object.keys(v).sort();
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = normalize(v[k]);
    return out;
  };

  return JSON.stringify(normalize(value));
}

async function resolveLawbookJsonPath(fileName: string): Promise<string> {
  // Try multiple path strategies to support both dev and production environments
  const candidatePaths = [
    // Strategy 1: Development - src/lawbook relative to project root
    path.resolve(process.cwd(), 'src/lawbook', fileName),
    // Strategy 2: Next.js standalone - relative to control-center directory
    path.resolve(process.cwd(), 'control-center/src/lawbook', fileName),
    // Strategy 3: Compiled module - same directory as this file
    path.resolve(__dirname, fileName),
    // Strategy 4: Next.js server chunks - go up from compiled location
    path.resolve(__dirname, '../../src/lawbook', fileName),
    path.resolve(__dirname, '../../../src/lawbook', fileName),
  ];

  const errors: string[] = [];
  
  for (const candidatePath of candidatePaths) {
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch (err) {
      errors.push(`${candidatePath}: ${err instanceof Error ? err.message : 'not found'}`);
    }
  }

  // If all strategies fail, throw a detailed error
  const errorMsg = `Failed to locate ${fileName}. Tried:\n${errors.join('\n')}`;
  throw new Error(errorMsg);
}

export function computeStableHash(value: unknown): string {
  const json = stableStringify(value);
  return createHash('sha256').update(json).digest('hex');
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (parseErr) {
      throw new Error(
        `Invalid JSON in ${path.basename(filePath)} (${filePath}): ${parseErr instanceof Error ? parseErr.message : 'parse error'}`
      );
    }
  } catch (readErr) {
    if (readErr && typeof readErr === 'object' && 'code' in readErr && readErr.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw new Error(
      `Failed to read ${path.basename(filePath)} (${filePath}): ${readErr instanceof Error ? readErr.message : 'unknown error'}`
    );
  }
}

function validateGuardrail(value: unknown, idx: number): Guardrail {
  assert(isRecord(value), `guardrails[${idx}] must be an object`);
  assert(typeof value.id === 'string' && value.id.trim(), `guardrails[${idx}].id must be a non-empty string`);
  assert(typeof value.title === 'string', `guardrails[${idx}].title must be a string`);
  assert(typeof value.description === 'string', `guardrails[${idx}].description must be a string`);
  assert(isScope(value.scope), `guardrails[${idx}].scope must be a valid scope`);
  assert(isCategory(value.category), `guardrails[${idx}].category must be a valid category`);
  assert(isEnforcement(value.enforcement), `guardrails[${idx}].enforcement must be a valid enforcement`);
  assert(isIsoDateString(value.createdAt), `guardrails[${idx}].createdAt must be an ISO string`);
  assert(isIsoDateString(value.updatedAt), `guardrails[${idx}].updatedAt must be an ISO string`);

  return {
    id: value.id,
    title: value.title,
    description: value.description,
    scope: value.scope,
    category: value.category,
    enforcement: value.enforcement,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function validateParameter(value: unknown, idx: number): LawbookParameter {
  assert(isRecord(value), `parameters[${idx}] must be an object`);
  assert(typeof value.key === 'string' && value.key.trim(), `parameters[${idx}].key must be a non-empty string`);
  assert(typeof value.title === 'string', `parameters[${idx}].title must be a string`);
  assert(typeof value.description === 'string', `parameters[${idx}].description must be a string`);
  assert(isScope(value.scope), `parameters[${idx}].scope must be a valid scope`);
  assert(isCategory(value.category), `parameters[${idx}].category must be a valid category`);
  assert(
    value.type === 'string' || value.type === 'number' || value.type === 'boolean' || value.type === 'json',
    `parameters[${idx}].type must be one of string|number|boolean|json`
  );
  assert(isIsoDateString(value.createdAt), `parameters[${idx}].createdAt must be an ISO string`);
  assert(isIsoDateString(value.updatedAt), `parameters[${idx}].updatedAt must be an ISO string`);

  return {
    key: value.key,
    title: value.title,
    description: value.description,
    scope: value.scope,
    category: value.category,
    type: value.type,
    defaultValue: value.defaultValue,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function validateMemoryEntry(value: unknown, idx: number): MemorySeedEntry {
  assert(isRecord(value), `entries[${idx}] must be an object`);
  assert(typeof value.id === 'string' && value.id.trim(), `entries[${idx}].id must be a non-empty string`);
  assert(typeof value.title === 'string', `entries[${idx}].title must be a string`);
  assert(typeof value.content === 'string', `entries[${idx}].content must be a string`);
  assert(isScope(value.scope), `entries[${idx}].scope must be a valid scope`);
  assert(isCategory(value.category), `entries[${idx}].category must be a valid category`);
  assert(isIsoDateString(value.createdAt), `entries[${idx}].createdAt must be an ISO string`);
  assert(isIsoDateString(value.updatedAt), `entries[${idx}].updatedAt must be an ISO string`);

  return {
    id: value.id,
    title: value.title,
    content: value.content,
    scope: value.scope,
    category: value.category,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function loadGuardrails(): Promise<LoadedLawbook<GuardrailsFile>> {
  const filePath = await resolveLawbookJsonPath('guardrails.json');
  const raw = await readJsonFile(filePath);
  assert(isRecord(raw), 'guardrails.json must be an object');
  assert(typeof raw.version === 'number', 'guardrails.json.version must be a number');
  assert(Array.isArray(raw.guardrails), 'guardrails.json.guardrails must be an array');

  const guardrails = raw.guardrails.map((g, idx) => validateGuardrail(g, idx));
  const normalized: GuardrailsFile = { version: raw.version, guardrails };
  return { hash: computeStableHash(normalized), data: normalized };
}

export async function loadParameters(): Promise<LoadedLawbook<ParametersFile>> {
  const filePath = await resolveLawbookJsonPath('parameters.json');
  const raw = await readJsonFile(filePath);
  assert(isRecord(raw), 'parameters.json must be an object');
  assert(typeof raw.version === 'number', 'parameters.json.version must be a number');
  assert(Array.isArray(raw.parameters), 'parameters.json.parameters must be an array');

  const parameters = raw.parameters.map((p, idx) => validateParameter(p, idx));
  const normalized: ParametersFile = { version: raw.version, parameters };
  return { hash: computeStableHash(normalized), data: normalized };
}

export async function loadMemorySeed(): Promise<LoadedLawbook<MemorySeedFile>> {
  const filePath = await resolveLawbookJsonPath('memory_seed.json');
  const raw = await readJsonFile(filePath);
  assert(isRecord(raw), 'memory_seed.json must be an object');
  assert(typeof raw.version === 'number', 'memory_seed.json.version must be a number');
  assert(Array.isArray(raw.entries), 'memory_seed.json.entries must be an array');

  const entries = raw.entries.map((e, idx) => validateMemoryEntry(e, idx));
  const normalized: MemorySeedFile = { version: raw.version, entries };
  return { hash: computeStableHash(normalized), data: normalized };
}
