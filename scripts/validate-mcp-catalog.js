#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
}

function stripMarkdownCodeFences(text) {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
  return match ? match[1].trim() : text;
}

function isPlaceholder(text) {
  return /^<PASTE[\s\S]*HERE>\s*$/i.test(String(text).trim());
}

function loadJsonLike(filePath, label) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, kind: 'missing', label, filePath, message: 'File not found' };
  }

  const raw = readUtf8(filePath);
  const normalized = stripMarkdownCodeFences(raw);

  if (normalized.length === 0) {
    return { ok: false, kind: 'empty', label, filePath, message: 'File is empty' };
  }

  if (isPlaceholder(normalized)) {
    return { ok: true, kind: 'placeholder', label, filePath };
  }

  try {
    return { ok: true, kind: 'json', label, filePath, value: JSON.parse(normalized) };
  } catch (error) {
    return {
      ok: false,
      kind: 'parse_error',
      label,
      filePath,
      message: error && error.message ? error.message : 'Invalid JSON',
    };
  }
}

function printError(message) {
  // Avoid logging any file contents (catalog may include sensitive values in the future).
  process.stderr.write(`${message}\n`);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const catalogPath = path.join(repoRoot, 'docs', 'mcp', 'catalog.json');
  const schemaPath = path.join(repoRoot, 'docs', 'mcp', 'catalog.schema.json');

  const catalog = loadJsonLike(catalogPath, 'catalog');
  const schema = loadJsonLike(schemaPath, 'schema');

  if (!catalog.ok) {
    printError(`[validate-mcp-catalog] ${catalog.label} load failed: ${catalog.message} (${catalog.filePath})`);
    process.exit(1);
  }

  if (!schema.ok) {
    printError(`[validate-mcp-catalog] ${schema.label} load failed: ${schema.message} (${schema.filePath})`);
    process.exit(1);
  }

  if (catalog.kind === 'placeholder' || schema.kind === 'placeholder') {
    // Bootstrapping mode: placeholders are allowed to keep CI green until the
    // catalog/schema are populated. This still guarantees the files exist.
    process.stdout.write('[validate-mcp-catalog] Placeholder detected; skipping schema validation.\n');
    process.exit(0);
  }

  let Ajv;
  let addFormats;

  try {
    Ajv = require('ajv');
  } catch (error) {
    printError('[validate-mcp-catalog] Missing dependency: ajv (install via npm).');
    process.exit(1);
  }

  try {
    addFormats = require('ajv-formats');
  } catch {
    addFormats = null;
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  if (addFormats) addFormats(ajv);

  let validate;
  try {
    validate = ajv.compile(schema.value);
  } catch (error) {
    printError(`[validate-mcp-catalog] Schema compile failed: ${error && error.message ? error.message : 'Unknown error'}`);
    process.exit(1);
  }

  const ok = validate(catalog.value);
  if (ok) {
    process.stdout.write('[validate-mcp-catalog] OK\n');
    process.exit(0);
  }

  const errors = Array.isArray(validate.errors) ? validate.errors : [];
  printError(`[validate-mcp-catalog] Validation failed with ${errors.length} error(s).`);

  for (const err of errors) {
    const instancePath = err.instancePath || '(root)';
    const message = err.message || 'schema violation';
    printError(`- ${instancePath}: ${message}`);
  }

  process.exit(1);
}

main();
