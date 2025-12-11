/**
 * API Route: Execute Agent
 * 
 * POST /api/agent/execute
 * 
 * Executes an LLM-based agent with MCP tool integration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentRunner } from '../../../../src/lib/agent-runner';
import { AgentConfig, AgentContext } from '../../../../src/lib/types/agent';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, config, serverNames } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Invalid prompt: must be a non-empty string' },
        { status: 400 }
      );
    }

    // Default config
    const agentConfig: AgentConfig = {
      provider: config?.provider || 'openai',
      model: config?.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: config?.temperature || 0.7,
      maxTokens: config?.maxTokens,
      maxIterations: config?.maxIterations || 10,
      systemPrompt: config?.systemPrompt || 'You are a helpful AI assistant with access to tools.',
    };

    console.log('[API] Executing agent', {
      provider: agentConfig.provider,
      model: agentConfig.model,
      promptLength: prompt.length,
    });

    const runner = getAgentRunner();
    
    // Load tools from MCP servers
    const tools = await runner.loadToolsFromMCP(serverNames);
    
    console.log('[API] Loaded tools for agent', {
      toolsCount: tools.length,
      servers: serverNames || 'all',
    });

    // Execute the agent
    const context: AgentContext = {
      prompt,
      tools,
    };

    const result = await runner.execute(context, agentConfig);

    console.log('[API] Agent execution completed', {
      iterations: result.metadata.iterations,
      toolCallsCount: result.toolCalls.length,
      totalTokens: result.usage.totalTokens,
      durationMs: result.metadata.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Error executing agent:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to execute agent',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
