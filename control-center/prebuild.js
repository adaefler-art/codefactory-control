/**
 * Pre-build script for Control Center
 * 
 * This script runs before the Next.js build process.
 * It generates build metadata for display in the application.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Generate build metadata
function generateBuildMetadata() {
  const metadata = {
    version: process.env.BUILD_VERSION || process.env.npm_package_version || '0.1.0',
    timestamp: process.env.BUILD_TIMESTAMP || new Date().toISOString(),
    commitHash: '',
    environment: process.env.BUILD_ENV || process.env.DEPLOY_ENV || 'development',
  };

  // Try to get git commit hash
  try {
    // Prioritize BUILD_COMMIT_HASH from environment (set during Docker build)
    if (process.env.BUILD_COMMIT_HASH) {
      metadata.commitHash = process.env.BUILD_COMMIT_HASH;
    } else {
      // Fallback to git command if available
      const commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      metadata.commitHash = commitHash.substring(0, 7);
    }
  } catch (error) {
    console.warn('Warning: Could not get git commit hash');
    metadata.commitHash = 'unknown';
  }

  // Write metadata to public directory
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const metadataPath = path.join(publicDir, 'build-metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  console.log('✓ Build metadata generated:', metadata);
}

// Run prebuild tasks
try {
  generateBuildMetadata();
  console.log('✓ Pre-build checks passed');
} catch (error) {
  console.error('✗ Pre-build failed:', error);
  process.exit(1);
}

