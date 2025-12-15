/**
 * Test script for Debug Mode functionality
 * 
 * Verifies that debug mode can be enabled and that debug logs are properly output.
 */

import { logger } from './src/lib/logger';

console.log('=== AFU-9 Debug Mode Test ===\n');

// Test 1: Check initial debug mode status
console.log('Test 1: Initial debug mode status');
console.log(`AFU9_DEBUG_MODE env var: ${process.env.AFU9_DEBUG_MODE}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

const isDebugEnabled = process.env.AFU9_DEBUG_MODE?.toLowerCase() === 'true' || 
                       process.env.AFU9_DEBUG_MODE === '1' ||
                       (process.env.NODE_ENV !== 'production' && process.env.AFU9_DEBUG_MODE !== 'false');

console.log(`Debug mode should be: ${isDebugEnabled ? 'ENABLED' : 'DISABLED'}\n`);

// Test 2: Test debug logging
console.log('Test 2: Testing debug log output');
logger.debug('This is a debug log', {
  testKey: 'testValue',
  timestamp: new Date().toISOString(),
}, 'TestComponent');

console.log('If debug mode is enabled, you should see a JSON log above.\n');

// Test 3: Test info logging (always visible)
console.log('Test 3: Testing info log output (always visible)');
logger.info('This is an info log', {
  testKey: 'testValue',
  timestamp: new Date().toISOString(),
}, 'TestComponent');

console.log('\n=== Test Complete ===');
console.log('\nTo test with debug mode explicitly:');
console.log('  Enabled:  AFU9_DEBUG_MODE=true ts-node test-debug-mode.ts');
console.log('  Disabled: AFU9_DEBUG_MODE=false ts-node test-debug-mode.ts');
