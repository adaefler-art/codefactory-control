import fs from "node:fs";
import path from "node:path";

function resolveFirstExisting(paths) {
  for (const candidate of paths) {
    if (!candidate) {
      continue;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractEndpoints(manifestContents) {
  const pattern = /\{[^}]*method:\s*"(GET|POST|PUT|DELETE|PATCH)"[^}]*path:\s*"([^"]+)"[^}]*\}/g;
  const matches = [];
  for (const match of manifestContents.matchAll(pattern)) {
    matches.push({ method: match[1], path: match[2] });
  }
  return matches;
}

const repoRoot = process.cwd();
const contractPath = path.resolve(repoRoot, "docs", "contracts", "engine-api.v1.md");

if (!fs.existsSync(contractPath)) {
  console.error("Contract file not found:", contractPath);
  process.exit(1);
}

const engineRepoPath = resolveFirstExisting([
  process.env.CODEFACTORY_ENGINE_PATH,
  path.resolve(repoRoot, "..", "codefactory-engine")
]);

if (!engineRepoPath) {
  console.error("Unable to locate codefactory-engine. Set CODEFACTORY_ENGINE_PATH.");
  process.exit(1);
}

const manifestPath = path.resolve(
  engineRepoPath,
  "packages",
  "engine",
  "src",
  "api",
  "endpointsManifest.ts"
);

if (!fs.existsSync(manifestPath)) {
  console.error("endpointsManifest.ts not found:", manifestPath);
  process.exit(1);
}

const manifestContents = fs.readFileSync(manifestPath, "utf8");
const endpoints = extractEndpoints(manifestContents);
const contractText = fs.readFileSync(contractPath, "utf8");

const missing = endpoints.filter((endpoint) => !contractText.includes(`${endpoint.method} ${endpoint.path}`));

if (missing.length > 0) {
  console.error("Missing endpoints in contract:");
  for (const endpoint of missing) {
    console.error(`- ${endpoint.method} ${endpoint.path}`);
  }
  process.exit(1);
}

console.log("Contract verification passed.");
