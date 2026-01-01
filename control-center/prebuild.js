/**
 * Pre-build script for Control Center
 * 
 * This script runs before the Next.js build process.
 * It generates build metadata for display in the application.
 * It also ensures workspace dependencies are built.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Build workspace dependencies
function buildWorkspaceDependencies() {
  const packagesDir = path.join(__dirname, '..', 'packages');
  const packages = ['deploy-memory', 'verdict-engine'];
  
  console.log('Building workspace dependencies...');
  
  for (const pkg of packages) {
    const pkgPath = path.join(packagesDir, pkg);
    const distPath = path.join(pkgPath, 'dist');
    
    // Check if package exists and doesn't have dist folder
    if (fs.existsSync(pkgPath) && !fs.existsSync(distPath)) {
      console.log(`  Building @codefactory/${pkg}...`);
      try {
        // Build the package
        execSync('npm run build', { 
          cwd: pkgPath, 
          stdio: 'inherit'
        });
        console.log(`  ✓ Built @codefactory/${pkg}`);
      } catch (error) {
        console.warn(`  Warning: Failed to build @codefactory/${pkg}:`, error.message);
      }
    } else if (fs.existsSync(distPath)) {
      console.log(`  ✓ @codefactory/${pkg} already built`);
    }
  }
}

// Generate build metadata
function generateBuildMetadata() {
  const metadata = {
    version: process.env.BUILD_VERSION || process.env.npm_package_version || 'unknown',
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
  buildWorkspaceDependencies();
  generateBuildMetadata();
  console.log('✓ Pre-build checks passed');
} catch (error) {
  console.error('✗ Pre-build failed:', error);
  process.exit(1);
}

