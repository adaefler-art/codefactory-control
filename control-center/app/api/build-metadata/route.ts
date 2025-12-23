import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/build-metadata
 * 
 * Returns build metadata including version, deploy timestamp, commit hash, and environment
 * 
 * Response:
 * {
 *   "version": "0.4.0",
 *   "timestamp": "2025-12-20T10:42:00.000Z",
 *   "commitHash": "a1b2c3d",
 *   "environment": "production"
 * }
 */
export async function GET() {
  try {
    // Try to read build metadata file
    const metadataPath = path.join(process.cwd(), 'public', 'build-metadata.json');
    
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      return NextResponse.json(metadata);
    }

    // Fallback metadata if file doesn't exist
    return NextResponse.json({
      version: process.env.BUILD_VERSION || process.env.npm_package_version || 'unknown',
      timestamp: new Date().toISOString(),
      commitHash: process.env.BUILD_COMMIT_HASH || 'unknown',
      environment: process.env.BUILD_ENV || process.env.DEPLOY_ENV || 'development',
    });
  } catch (error) {
    console.error('Error reading build metadata:', error);
    
    // Fallback metadata on error
    return NextResponse.json({
      version: process.env.BUILD_VERSION || process.env.npm_package_version || 'unknown',
      timestamp: new Date().toISOString(),
      commitHash: 'unknown',
      environment: 'unknown',
    });
  }
}
