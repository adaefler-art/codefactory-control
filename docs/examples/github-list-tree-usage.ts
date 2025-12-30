/**
 * GitHub List Tree Usage Examples
 * 
 * Reference: I712 (E71.2) - Tool listTree
 * 
 * This file demonstrates how to use the listTree tool to list repository contents
 * with deterministic ordering, cursor-based pagination, and policy enforcement.
 * 
 * Includes both TypeScript (server-side) and PowerShell (API client) examples.
 */

import { listTree, ListTreeParams, ListTreeResult } from '@/lib/github/list-tree';

// ========================================
// PowerShell API Examples
// ========================================

/**
 * PowerShell: List repository root
 * 
 * ```powershell
 * $baseUrl = "http://localhost:3000"  # or your deployed URL
 * $response = Invoke-RestMethod -Uri "$baseUrl/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main" -Method GET
 * 
 * # Display results
 * Write-Host "Total items: $($response.pageInfo.totalEstimate)"
 * $response.items | ForEach-Object {
 *   Write-Host "$($_.type): $($_.path)"
 * }
 * ```
 */

/**
 * PowerShell: List specific subdirectory
 * 
 * ```powershell
 * $baseUrl = "http://localhost:3000"
 * $params = @{
 *   owner = "adaefler-art"
 *   repo = "codefactory-control"
 *   branch = "main"
 *   path = "control-center/src"
 *   recursive = "false"
 * }
 * 
 * $queryString = ($params.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "&"
 * $response = Invoke-RestMethod -Uri "$baseUrl/api/integrations/github/list-tree?$queryString" -Method GET
 * 
 * Write-Host "Contents of $($response.meta.path):"
 * $response.items | ForEach-Object {
 *   Write-Host "  $($_.name) ($($_.type))"
 * }
 * ```
 */

/**
 * PowerShell: Recursive listing with pagination
 * 
 * ```powershell
 * $baseUrl = "http://localhost:3000"
 * $allItems = @()
 * $cursor = $null
 * 
 * do {
 *   $params = @{
 *     owner = "adaefler-art"
 *     repo = "codefactory-control"
 *     branch = "main"
 *     path = "docs"
 *     recursive = "true"
 *     limit = "50"
 *   }
 *   
 *   if ($cursor) {
 *     $params.cursor = $cursor
 *   }
 *   
 *   $queryString = ($params.GetEnumerator() | ForEach-Object { "$($_.Key)=$([System.Web.HttpUtility]::UrlEncode($_.Value))" }) -join "&"
 *   $response = Invoke-RestMethod -Uri "$baseUrl/api/integrations/github/list-tree?$queryString" -Method GET
 *   
 *   $allItems += $response.items
 *   $cursor = $response.pageInfo.nextCursor
 *   
 *   Write-Host "Fetched $($response.items.Count) items (total: $($allItems.Count))"
 * } while ($cursor)
 * 
 * Write-Host "`nTotal items fetched: $($allItems.Count)"
 * ```
 */

/**
 * PowerShell: Error handling
 * 
 * ```powershell
 * $baseUrl = "http://localhost:3000"
 * 
 * try {
 *   # Try to access repository not in allowlist
 *   $response = Invoke-RestMethod -Uri "$baseUrl/api/integrations/github/list-tree?owner=other-org&repo=private-repo&branch=main" -Method GET
 * } catch {
 *   $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
 *   
 *   Write-Host "Error Code: $($errorDetails.code)" -ForegroundColor Red
 *   Write-Host "Message: $($errorDetails.error)" -ForegroundColor Red
 *   
 *   if ($errorDetails.code -eq "REPO_NOT_ALLOWED") {
 *     Write-Host "Repository access denied by policy" -ForegroundColor Yellow
 *   } elseif ($errorDetails.code -eq "INVALID_PATH") {
 *     Write-Host "Invalid path provided" -ForegroundColor Yellow
 *   } elseif ($errorDetails.code -eq "TREE_TOO_LARGE") {
 *     Write-Host "Tree too large - try non-recursive mode or narrower path" -ForegroundColor Yellow
 *   }
 * }
 * ```
 */

/**
 * PowerShell: Filter files by extension
 * 
 * ```powershell
 * $baseUrl = "http://localhost:3000"
 * $response = Invoke-RestMethod -Uri "$baseUrl/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main&path=control-center/src&recursive=true" -Method GET
 * 
 * # Filter TypeScript files
 * $tsFiles = $response.items | Where-Object { $_.type -eq "file" -and $_.path -match "\.ts$" }
 * 
 * Write-Host "TypeScript files in control-center/src:"
 * $tsFiles | ForEach-Object {
 *   Write-Host "  $($_.path) ($($_.size) bytes)"
 * }
 * 
 * Write-Host "`nTotal TS files: $($tsFiles.Count)"
 * ```
 */

// ========================================
// Example 1: Basic Non-Recursive Listing
// ========================================

/**
 * List files and directories at repository root
 */
async function example1_basicListing() {
  const result = await listTree({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: '',
    recursive: false,
  });

  console.log('Repository root contents:');
  result.items.forEach((item) => {
    console.log(`  ${item.type === 'dir' ? '📁' : '📄'} ${item.path}`);
  });

  console.log('\nMetadata:');
  console.log(`  Total items: ${result.pageInfo.totalEstimate}`);
  console.log(`  Ordering: ${result.meta.ordering}`);
  console.log(`  Generated at: ${result.meta.generatedAt}`);
}

// ========================================
// Example 2: List Specific Subdirectory
// ========================================

/**
 * List contents of a specific directory
 */
async function example2_subdirectoryListing() {
  const result = await listTree({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src/lib',
    recursive: false,
  });

  console.log('Contents of control-center/src/lib:');
  result.items.forEach((item) => {
    console.log(`  ${item.type}: ${item.name} (${item.sha?.substring(0, 7)})`);
  });
}

// ========================================
// Example 3: Recursive Listing
// ========================================

/**
 * Recursively list all files in a directory tree
 */
async function example3_recursiveListing() {
  const result = await listTree({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'docs',
    recursive: true,
    limit: 100,
  });

  console.log('All files in docs/ (recursive):');
  result.items.forEach((item) => {
    const indent = '  '.repeat((item.path.match(/\//g) || []).length);
    console.log(`${indent}${item.name} (${item.type})`);
  });

  console.log(`\nTotal: ${result.pageInfo.totalEstimate} items`);
}

// ========================================
// Example 4: Paginated Listing
// ========================================

/**
 * Fetch large directory in pages
 */
async function example4_paginatedListing() {
  let cursor: string | undefined;
  let pageNum = 1;
  let allItems: any[] = [];

  console.log('Fetching repository tree in pages...\n');

  do {
    const result = await listTree({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      path: '',
      recursive: true,
      cursor,
      limit: 50, // Small page size for demonstration
    });

    console.log(`Page ${pageNum}: ${result.items.length} items`);
    allItems.push(...result.items);

    cursor = result.pageInfo.nextCursor || undefined;
    pageNum++;

    // Safety limit for demo
    if (pageNum > 10) break;
  } while (cursor);

  console.log(`\nTotal items fetched: ${allItems.length}`);
  
  // Verify no duplicates
  const uniquePaths = new Set(allItems.map((i) => i.path));
  console.log(`Unique paths: ${uniquePaths.size}`);
  console.log(`Duplicates: ${uniquePaths.size !== allItems.length ? 'YES ❌' : 'NO ✅'}`);
}

// ========================================
// Example 5: Error Handling
// ========================================

/**
 * Handle various error scenarios
 */
async function example5_errorHandling() {
  try {
    // Example: Invalid path (traversal attempt)
    await listTree({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      path: '../etc/passwd',
      recursive: false,
    });
  } catch (error: any) {
    console.log('Invalid path error:');
    console.log(`  Code: ${error.code}`);
    console.log(`  Message: ${error.message}`);
    console.log(`  Details:`, error.details);
  }

  try {
    // Example: Repository not in allowlist
    await listTree({
      owner: 'some-org',
      repo: 'private-repo',
      branch: 'main',
      path: '',
      recursive: false,
    });
  } catch (error: any) {
    console.log('\nPolicy enforcement error:');
    console.log(`  Code: ${error.code}`);
    console.log(`  Message: ${error.message}`);
  }

  try {
    // Example: Non-existent path
    await listTree({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      path: 'nonexistent/directory',
      recursive: false,
    });
  } catch (error: any) {
    console.log('\nGitHub API error:');
    console.log(`  Code: ${error.code}`);
    console.log(`  HTTP Status: ${error.details?.httpStatus}`);
  }
}

// ========================================
// Example 6: API Route Handler
// ========================================

/**
 * Example Next.js API route using listTree
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const params: ListTreeParams = {
    owner: searchParams.get('owner') || 'adaefler-art',
    repo: searchParams.get('repo') || 'codefactory-control',
    branch: searchParams.get('branch') || 'main',
    path: searchParams.get('path') || '',
    recursive: searchParams.get('recursive') === 'true',
    cursor: searchParams.get('cursor') || undefined,
    limit: parseInt(searchParams.get('limit') || '200'),
  };

  try {
    const result = await listTree(params);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: {
          code: error.code || 'UNKNOWN_ERROR',
          message: error.message,
          details: error.details || {},
        },
      },
      { status: error.details?.httpStatus || 500 }
    );
  }
}

// ========================================
// Example 7: Filter Files by Extension
// ========================================

/**
 * Get all TypeScript files in a directory
 */
async function example7_filterByExtension() {
  const result = await listTree({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src',
    recursive: true,
  });

  const tsFiles = result.items.filter(
    (item) => item.type === 'file' && item.path.endsWith('.ts')
  );

  console.log('TypeScript files in control-center/src:');
  tsFiles.forEach((file) => {
    console.log(`  ${file.path} (${file.size} bytes)`);
  });

  console.log(`\nTotal TS files: ${tsFiles.length}`);
}

// ========================================
// Example 8: Streaming Large Trees
// ========================================

/**
 * Stream large tree results for processing
 */
async function* streamTreeEntries(params: Omit<ListTreeParams, 'cursor'>) {
  let cursor: string | undefined;
  
  do {
    const result = await listTree({ ...params, cursor });
    
    for (const item of result.items) {
      yield item;
    }
    
    cursor = result.pageInfo.nextCursor || undefined;
  } while (cursor);
}

async function example8_streamingListing() {
  console.log('Streaming repository tree...\n');
  
  let count = 0;
  for await (const item of streamTreeEntries({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: '',
    recursive: true,
    limit: 100,
  })) {
    count++;
    if (count <= 10) {
      console.log(`  ${item.path}`);
    }
  }
  
  console.log(`\n... and ${count - 10} more items`);
}

// ========================================
// Example 9: Compare Branches
// ========================================

/**
 * Compare directory structure across branches
 */
async function example9_compareBranches() {
  const [mainTree, developTree] = await Promise.all([
    listTree({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      path: 'control-center/src',
      recursive: true,
    }),
    listTree({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'develop',
      path: 'control-center/src',
      recursive: true,
    }),
  ]);

  const mainPaths = new Set(mainTree.items.map((i) => i.path));
  const developPaths = new Set(developTree.items.map((i) => i.path));

  const onlyInMain = [...mainPaths].filter((p) => !developPaths.has(p));
  const onlyInDevelop = [...developPaths].filter((p) => !mainPaths.has(p));

  console.log('Files only in main:');
  onlyInMain.forEach((p) => console.log(`  + ${p}`));

  console.log('\nFiles only in develop:');
  onlyInDevelop.forEach((p) => console.log(`  + ${p}`));
}

// ========================================
// Run Examples
// ========================================

if (require.main === module) {
  (async () => {
    console.log('='.repeat(60));
    console.log('GitHub List Tree - Usage Examples');
    console.log('='.repeat(60));
    console.log();

    // Uncomment to run specific examples:
    // await example1_basicListing();
    // await example2_subdirectoryListing();
    // await example3_recursiveListing();
    // await example4_paginatedListing();
    // await example5_errorHandling();
    // await example7_filterByExtension();
    // await example8_streamingListing();
    // await example9_compareBranches();
  })();
}
