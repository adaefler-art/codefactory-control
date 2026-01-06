#!/usr/bin/env node

/**
 * Generate Endpoint Inventory
 * 
 * Scans control-center/app/api directory for route.ts files
 * and generates a deterministic list of all API endpoints.
 * 
 * Usage:
 *   node scripts/generate-endpoint-inventory.js
 *   node scripts/generate-endpoint-inventory.js --json
 * 
 * Output:
 *   - Default: Pretty-printed list of endpoints
 *   - --json: JSON array of endpoints
 */

const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, '../control-center/app/api');

/**
 * Recursively find all route.ts files and convert to URL paths
 * @param {string} dir - Directory to scan
 * @param {string} basePath - Base URL path (default: /api)
 * @returns {string[]} - Array of endpoint paths
 */
function findRouteFiles(dir, basePath = '/api') {
  let routes = [];
  
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      const urlPath = path.join(basePath, item.name);
      
      if (item.isDirectory()) {
        // Dynamic route segment [param] → :param
        if (item.name.startsWith('[') && item.name.endsWith(']')) {
          const param = item.name.slice(1, -1);
          routes = routes.concat(findRouteFiles(fullPath, path.join(basePath, `:${param}`)));
        } else {
          routes = routes.concat(findRouteFiles(fullPath, urlPath));
        }
      } else if (item.name === 'route.ts') {
        // Found a route file - add the current path
        routes.push(basePath.replace(/\\/g, '/'));
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dir}:`, err.message);
  }
  
  return routes;
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  
  if (!fs.existsSync(appDir)) {
    console.error(`Error: API directory not found: ${appDir}`);
    console.error('Make sure you run this script from the repository root.');
    process.exit(1);
  }
  
  // Generate endpoint list
  const routes = findRouteFiles(appDir).sort();
  
  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(routes, null, 2));
  } else {
    console.log(`# AFU-9 Control Center API Endpoints\n`);
    console.log(`Total Endpoints: ${routes.length}\n`);
    console.log(`Generated: ${new Date().toISOString()}\n`);
    console.log(`---\n`);
    routes.forEach((route, index) => {
      console.log(`${(index + 1).toString().padStart(3, ' ')}. ${route}`);
    });
  }
}

// Run
if (require.main === module) {
  main();
}

module.exports = { findRouteFiles };
