import { execSync } from "node:child_process";

/**
 * Pre-commit Gate
 * 
 * Part of ISSUE 1 & 4 — Repo Canon & Guardrails + Repo Hygiene Automation
 * 
 * Enforces:
 * - No forbidden paths in staged changes (.next/, .worktrees/, standalone/)
 * - No mixed-scope changes (control-center + infra)
 * - Repository canon verification (routes, empty folders, etc.)
 * 
 * Usage:
 *   node scripts/precommit-gate.mjs
 *   ALLOW_MIXED_CHANGES=true git commit  # Override mixed-scope check
 */

function run(cmd) {
  return execSync(cmd, { stdio: "inherit" });
}

function capture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`\n❌ PRE-COMMIT BLOCKED: ${msg}\n`);
  process.exit(1);
}

function info(msg) {
  console.log(`\nℹ️  ${msg}\n`);
}

const overrideMixed = String(process.env.ALLOW_MIXED_CHANGES || "").toLowerCase() === "true";

// Only consider staged changes (what will be committed)
const staged = capture("git diff --cached --name-only");

if (!staged) {
  info("No staged changes.");
  process.exit(0);
}

const files = staged.split(/\r?\n/).filter(Boolean);

// Forbidden paths
const forbiddenPrefixes = [
  "control-center/.next/",
  "control-center/.next\\",
  ".next/",
  ".next\\",
  ".worktrees/",
  ".worktrees\\",
  "standalone/",
  "standalone\\",
];

const forbiddenHits = files.filter((f) =>
  forbiddenPrefixes.some((p) => f.startsWith(p))
);

if (forbiddenHits.length) {
  fail(
    `Forbidden paths detected in staged changes:\n` +
      forbiddenHits.map((f) => `  - ${f}`).join("\n") +
      `\nRemove these files from staging (git restore --staged <file>)`
  );
}

// Mixed-scope check (control-center vs infra)
const isControlCenter = (f) => f.startsWith("control-center/") || f.startsWith("control-center\\");
const isInfra = (f) =>
  f.startsWith("lib/") ||
  f.startsWith("lib\\") ||
  f.startsWith("infra/") ||
  f.startsWith("infra\\") ||
  f.startsWith("cdk/") ||
  f.startsWith("cdk\\") ||
  f.endsWith("lib/afu9-ecs-stack.ts") ||
  f.endsWith("lib/afu9-iam-stack.ts");

const touchedControlCenter = files.some(isControlCenter);
const touchedInfra = files.some(isInfra);

if (touchedControlCenter && touchedInfra && !overrideMixed) {
  fail(
    `Mixed scope staged changes detected (control-center + infra).\n` +
      `Split into two commits/PRs, or set ALLOW_MIXED_CHANGES=true for this commit only.`
  );
}

// Guardrails (fast first)
try {
  run("npm run repo:verify");
} catch {
  fail("npm run repo:verify failed.");
}

try {
  // only run if script exists
  const scriptsJson = capture("node -e \"console.log(JSON.stringify(require('./package.json').scripts||{}))\"");
  const scripts = JSON.parse(scriptsJson);
  if (scripts["routes:verify"]) {
    run("npm run routes:verify");
  } else {
    info("routes:verify not found in package.json scripts. Skipping.");
  }
} catch {
  fail("npm run routes:verify failed.");
}

info("Pre-commit gate passed.");
process.exit(0);
