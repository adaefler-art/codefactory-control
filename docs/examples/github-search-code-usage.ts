/**
 * Example usage of the searchCode tool
 * 
 * Reference: I714 (E71.4) - Tool searchCode
 */

import { searchCode } from '../src/lib/github/search-code';

/**
 * Example 1: Basic code search
 */
async function example1_basicSearch() {
  const result = await searchCode({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    query: 'searchCode',
  });

  console.log('Found', result.items.length, 'results');
  result.items.forEach((item) => {
    console.log(`- ${item.path} (hash: ${item.match.previewHash})`);
    console.log(`  Preview: ${item.match.preview.substring(0, 100)}...`);
  });
}

/**
 * Example 2: Search with path prefix
 */
async function example2_searchWithPathPrefix() {
  const result = await searchCode({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    query: 'function',
    pathPrefix: 'control-center/src/lib/github',
  });

  console.log('Found', result.items.length, 'results in control-center/src/lib/github/');
}

/**
 * Example 3: Search with file globs
 */
async function example3_searchWithFileGlobs() {
  const result = await searchCode({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    query: 'interface',
    fileGlobs: ['*.ts', '*.tsx'],
  });

  console.log('Found', result.items.length, 'TypeScript files containing "interface"');
}

/**
 * Example 4: Pagination
 */
async function example4_pagination() {
  // First page
  const page1 = await searchCode({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    query: 'test',
    limit: 10,
  });

  console.log('Page 1:', page1.items.length, 'results');

  // Second page
  if (page1.pageInfo.nextCursor) {
    const page2 = await searchCode({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      query: 'test',
      limit: 10,
      cursor: page1.pageInfo.nextCursor,
    });

    console.log('Page 2:', page2.items.length, 'results');
  }
}

/**
 * Example 5: Verify result hashing
 */
async function example5_verifyHashing() {
  const result = await searchCode({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    query: 'searchCode',
    limit: 1,
  });

  if (result.items.length > 0) {
    const item = result.items[0];
    console.log('Result hashing:');
    console.log('- Preview length:', item.match.preview.length);
    console.log('- Full SHA-256:', item.match.previewSha256);
    console.log('- Short hash (12 chars):', item.match.previewHash);
    console.log('- Deterministic:', item.match.previewHash === item.match.previewSha256.substring(0, 12));
  }
}

/**
 * Example 6: Error handling
 */
async function example6_errorHandling() {
  try {
    // Query too short
    await searchCode({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      query: 'a', // Too short (min 2 chars)
    });
  } catch (error: any) {
    console.log('Query validation error:', error.code); // QUERY_INVALID
  }

  try {
    // Repository not allowed
    await searchCode({
      owner: 'some-other-owner',
      repo: 'not-allowed-repo',
      branch: 'main',
      query: 'test',
    });
  } catch (error: any) {
    console.log('Access denied error:', error.code); // REPO_NOT_ALLOWED
  }
}

// Run examples (uncomment to execute)
// example1_basicSearch();
// example2_searchWithPathPrefix();
// example3_searchWithFileGlobs();
// example4_pagination();
// example5_verifyHashing();
// example6_errorHandling();

export {
  example1_basicSearch,
  example2_searchWithPathPrefix,
  example3_searchWithFileGlobs,
  example4_pagination,
  example5_verifyHashing,
  example6_errorHandling,
};
