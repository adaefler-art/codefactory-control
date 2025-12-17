/**
 * Example: Using the Canonical Prompt Library
 * 
 * This example demonstrates how to:
 * 1. Load a versioned prompt from the library
 * 2. Execute an agent with the prompt
 * 3. Track the prompt version in agent runs
 * 4. Query prompt stability metrics
 */

import { getAgentRunner } from '../control-center/src/lib/agent-runner';
import { getPromptLibraryService } from '../control-center/src/lib/prompt-library-service';
import { AgentConfig, AgentContext } from '../control-center/src/lib/types/agent';

async function exampleUsingPromptLibrary() {
  console.log('=== Example: Using Canonical Prompt Library ===\n');

  // 1. Load a prompt from the canonical library
  console.log('1. Loading prompt from canonical library...');
  const agentRunner = getAgentRunner();
  const promptData = await agentRunner.loadPromptFromLibrary('issue_analyzer', {
    title: 'Fix authentication bug in login flow',
    body: 'Users are unable to log in after password reset. Error: "Invalid token".',
    labels: 'bug, authentication, high-priority',
  });

  console.log('   ✓ Loaded prompt:', {
    promptVersionId: promptData.promptVersionId,
    promptLength: promptData.prompt.length,
    hasSystemPrompt: !!promptData.systemPrompt,
  });

  // 2. Execute agent with versioned prompt
  console.log('\n2. Executing agent with versioned prompt...');
  
  // Load MCP tools
  const tools = await agentRunner.loadToolsFromMCP(['github']);

  const context: AgentContext = {
    prompt: promptData.prompt,
    tools: tools,
  };

  const config: AgentConfig = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: promptData.systemPrompt,
    temperature: 0.2,  // Use model config from prompt
    maxTokens: 2000,
    maxIterations: 5,
  };

  // Note: In production, the agent_run record would store:
  // - prompt_version_id: promptData.promptVersionId
  // - prompt_content: Full snapshot of the prompt
  // - prompt_variables: The variables used
  const result = await agentRunner.execute(context, config);

  console.log('   ✓ Agent execution completed:', {
    iterations: result.metadata.iterations,
    toolCalls: result.toolCalls.length,
    totalTokens: result.usage.totalTokens,
    durationMs: result.metadata.durationMs,
  });

  console.log('\n   Response summary:', result.response.substring(0, 200) + '...');

  // 3. Query prompt information from library
  console.log('\n3. Querying prompt information...');
  const promptService = getPromptLibraryService();
  const promptInfo = await promptService.getPromptByName('issue_analyzer');

  if (promptInfo && promptInfo.currentVersion) {
    console.log('   ✓ Prompt metadata:', {
      name: promptInfo.name,
      category: promptInfo.category,
      currentVersion: promptInfo.currentVersion.version,
      versionCount: promptInfo.versionCount,
      deprecated: promptInfo.deprecated,
    });
  }

  // 4. Query prompt stability metrics (KPI)
  console.log('\n4. Querying prompt stability metrics...');
  const metrics = await promptService.getPromptStabilityMetrics({
    category: 'analysis',
    limit: 5,
  });

  console.log('   ✓ Top prompts by usage:');
  metrics.forEach((metric, idx) => {
    console.log(`      ${idx + 1}. ${metric.promptName} v${metric.currentVersion}:`);
    console.log(`         - Total uses: ${metric.totalUses}`);
    console.log(`         - Executions: ${metric.executionsUsingPrompt}`);
    console.log(`         - Version count: ${metric.versionCount}`);
    console.log(`         - Deprecated: ${metric.isDeprecated}`);
  });

  console.log('\n=== Example completed successfully ===');
}

/**
 * Example: Creating a new version of a prompt
 */
async function exampleCreatingPromptVersion() {
  console.log('\n=== Example: Creating New Prompt Version ===\n');

  const promptService = getPromptLibraryService();

  // Get the current prompt
  const prompt = await promptService.getPromptByName('issue_analyzer');
  
  if (!prompt) {
    console.error('Prompt not found');
    return;
  }

  console.log('Current prompt version:', prompt.currentVersion?.version);

  // Create a new MINOR version (adding optional variable)
  console.log('\n1. Creating new MINOR version (1.1.0)...');
  const newVersion = await promptService.createPromptVersion({
    promptId: prompt.id,
    changeType: 'minor',
    changeDescription: 'Added optional repository_context variable for enhanced analysis',
    content: prompt.currentVersion!.content,
    systemPrompt: prompt.currentVersion!.systemPrompt,
    userPromptTemplate: prompt.currentVersion!.userPromptTemplate! + 
      '\n\nRepository Context: ${repository_context}',
    variables: {
      ...prompt.currentVersion!.variables,
      repository_context: 'Optional: Additional context about the repository structure and conventions',
    },
    modelConfig: prompt.currentVersion!.modelConfig,
    createdBy: 'example-script',
  });

  console.log('   ✓ New version created:', {
    version: newVersion.version,
    changeType: newVersion.changeType,
    published: newVersion.published,
  });

  // List all versions
  console.log('\n2. Listing all versions of the prompt...');
  const versions = await promptService.listPromptVersions(prompt.id);
  
  console.log(`   ✓ Total versions: ${versions.length}`);
  versions.forEach(v => {
    console.log(`      - v${v.version} (${v.changeType}): ${v.changeDescription}`);
  });

  console.log('\n=== Version creation example completed ===');
}

/**
 * Example: Handling breaking changes
 */
async function exampleBreakingChange() {
  console.log('\n=== Example: Creating MAJOR Version (Breaking Change) ===\n');

  const promptService = getPromptLibraryService();

  // This example shows how to create a MAJOR version with breaking changes
  // In practice, you would:
  // 1. Document the breaking change
  // 2. Provide migration guide
  // 3. Notify affected workflows
  // 4. Allow grace period (30 days for MAJOR)

  console.log('Steps for MAJOR version with breaking changes:');
  console.log('1. Document all breaking changes');
  console.log('2. Create comprehensive migration guide');
  console.log('3. Identify affected workflows');
  console.log('4. Notify stakeholders 30 days in advance');
  console.log('5. Create new version via API');
  console.log('6. Update canonical registry documentation');
  console.log('7. Monitor adoption metrics');

  // Example API call (commented out - use in production):
  /*
  const majorVersion = await promptService.createPromptVersion({
    promptId: 'prompt-uuid',
    changeType: 'major',
    changeDescription: 'Renamed variable issue_text to issue_body for clarity',
    breakingChanges: 'Variable "issue_text" has been renamed to "issue_body"',
    migrationGuide: `
      Update all workflow variable references:
      
      Before:
      { "issue_text": "..." }
      
      After:
      { "issue_body": "..." }
      
      Affected workflows: workflow-1, workflow-2
    `,
    // ... other fields
  });
  */

  console.log('\nSee PROMPT_GOVERNANCE.md for complete breaking change procedures.');
}

/**
 * Example: Querying prompt usage in agent runs
 */
async function exampleQueryingPromptUsage() {
  console.log('\n=== Example: Querying Prompt Usage in Agent Runs ===\n');

  // Note: This example requires database connection
  // Import getPool dynamically to avoid issues in different environments
  try {
    const db = await import('../control-center/src/lib/db.js');
    const pool = db.getPool();

  // Query 1: Find all agent runs using a specific prompt
  console.log('1. Finding agent runs using issue_analyzer prompt...');
  const runsResult = await pool.query(`
    SELECT 
      ar.id,
      ar.started_at,
      pv.version,
      ar.duration_ms,
      ar.total_tokens
    FROM agent_runs ar
    JOIN prompt_versions pv ON ar.prompt_version_id = pv.id
    JOIN prompts p ON pv.prompt_id = p.id
    WHERE p.name = $1
    ORDER BY ar.started_at DESC
    LIMIT 10
  `, ['issue_analyzer']);

  console.log(`   ✓ Found ${runsResult.rows.length} recent runs`);

  // Query 2: Get prompt stability metrics
  console.log('\n2. Checking prompt stability metrics...');
  const metricsResult = await pool.query(`
    SELECT * FROM prompt_stability_metrics
    WHERE prompt_name = $1
  `, ['issue_analyzer']);

  if (metricsResult.rows.length > 0) {
    const metric = metricsResult.rows[0];
    console.log('   ✓ Stability metrics:', {
      totalUses: metric.total_uses,
      daysUsed: metric.days_used,
      versionCount: metric.version_count,
      lastUsed: metric.last_used_at,
    });
  }

  // Query 3: Find deprecated prompts still in use
  console.log('\n3. Checking for deprecated prompts in use...');
  const deprecatedResult = await pool.query(`
    SELECT 
      p.name,
      p.deprecation_reason,
      COUNT(ar.id) as recent_uses
    FROM prompts p
    JOIN prompt_versions pv ON p.current_version_id = pv.id
    JOIN agent_runs ar ON ar.prompt_version_id = pv.id
    WHERE p.deprecated = true
      AND ar.started_at > NOW() - INTERVAL '7 days'
    GROUP BY p.id, p.name, p.deprecation_reason
  `);

  if (deprecatedResult.rows.length > 0) {
    console.log('   ⚠ Warning: Deprecated prompts still in use:');
    deprecatedResult.rows.forEach(row => {
      console.log(`      - ${row.name}: ${row.recent_uses} uses (Reason: ${row.deprecation_reason})`);
    });
  } else {
    console.log('   ✓ No deprecated prompts in use');
  }

  console.log('\n=== Usage query example completed ===');
  
  } catch (error) {
    console.error('Error querying prompt usage:', error);
    console.log('Note: This example requires database connection');
  }
}

// Run examples
async function main() {
  try {
    // Example 1: Using a prompt from the library
    await exampleUsingPromptLibrary();

    // Example 2: Creating a new version
    // await exampleCreatingPromptVersion();

    // Example 3: Breaking changes (documentation only)
    await exampleBreakingChange();

    // Example 4: Querying usage
    // await exampleQueryingPromptUsage();

  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Export examples for use in other scripts
export {
  exampleUsingPromptLibrary,
  exampleCreatingPromptVersion,
  exampleBreakingChange,
  exampleQueryingPromptUsage,
};