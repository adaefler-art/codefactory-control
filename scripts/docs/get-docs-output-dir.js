const fs = require('fs');
const path = require('path');

function readCurrentDocsVersion(repoRoot) {
  const fromEnv = (process.env.AFU9_DOCS_VERSION || '').trim();
  if (fromEnv) return fromEnv;

  const versionFile = path.join(repoRoot, 'docs', 'CURRENT_VERSION');
  try {
    const content = fs.readFileSync(versionFile, 'utf8').trim();
    if (content) return content;
  } catch {
    // ignore
  }

  return 'v05';
}

function getDocsOutputDir(repoRoot) {
  const docsVersion = readCurrentDocsVersion(repoRoot);
  return path.join(repoRoot, 'docs', docsVersion, 'generated');
}

module.exports = {
  readCurrentDocsVersion,
  getDocsOutputDir,
};
