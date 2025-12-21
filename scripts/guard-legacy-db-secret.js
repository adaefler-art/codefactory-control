#!/usr/bin/env node
/*
 * Guardrail: fail if any file in the repo still references the legacy
 * Secrets Manager path "afu9/database/master". The canonical secret name
 * is "afu9/database" (AWS may append a random suffix for rotation).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BANNED = 'afu9/database/master';
const SKIP_DIRS = new Set([
  '.git',
  '.github/workflows/.cache',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '.vscode',
  '.idea',
]);

async function walk(dir, findings) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(entryPath, findings);
    } else if (entry.isFile()) {
      const content = await fs.promises.readFile(entryPath, 'utf8');
      const idx = content.indexOf(BANNED);
      if (idx !== -1) {
        const relPath = path.relative(ROOT, entryPath);
        findings.push({ path: relPath });
      }
    }
  }
}

(async () => {
  const findings = [];
  await walk(ROOT, findings);
  if (findings.length > 0) {
    const header = `Detected ${findings.length} file(s) containing legacy secret path ${BANNED}`;
    console.error(header);
    for (const f of findings) {
      console.error(`- ${f.path}`);
    }
    process.exit(1);
  }
  console.log(`✅ No references to ${BANNED} found`);
})();
