/**
 * API Route: System Configuration Status
 * 
 * GET /api/system/config
 * 
 * Returns sanitized system configuration information without exposing secrets.
 */

import { NextResponse } from 'next/server';
import { isDebugModeEnabled } from '@/lib/debug-mode';

export async function GET() {
  try {
    // Check which integrations are configured without exposing secrets
    const githubConfigured = !!process.env.GITHUB_TOKEN;
    const githubOwner = process.env.GITHUB_OWNER || process.env.NEXT_PUBLIC_GITHUB_OWNER || null;
    
    const awsRegion = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'eu-central-1';
    
    // Determine LLM provider without exposing keys
    let llmProvider = 'Nicht konfiguriert';
    if (process.env.OPENAI_API_KEY) {
      llmProvider = 'OpenAI';
    } else if (process.env.ANTHROPIC_API_KEY) {
      llmProvider = 'Anthropic';
    } else if (process.env.DEEPSEEK_API_KEY) {
      llmProvider = 'DeepSeek';
    }
    
    const llmConfigured = llmProvider !== 'Nicht konfiguriert';
    
    // Check debug mode status using centralized utility
    const debugMode = isDebugModeEnabled();

    return NextResponse.json({
      integrations: {
        github: {
          configured: githubConfigured,
          owner: githubOwner,
        },
        aws: {
          region: awsRegion,
        },
        llm: {
          provider: llmProvider,
          configured: llmConfigured,
        },
      },
      system: {
        version: 'v0.2 (ECS)',
        architecture: 'AFU-9 (Ninefold)',
        environment: process.env.NODE_ENV || 'development',
        database: process.env.DATABASE_NAME || 'afu9',
        debugMode,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching system config:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch system configuration',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
