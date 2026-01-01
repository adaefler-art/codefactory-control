/**
 * MCP Catalog Loader
 * 
 * Loads MCP server definitions from the canonical catalog at docs/mcp/catalog.json
 * This ensures the UI always displays all configured MCP servers without hardcoding.
 */

import fs from 'fs';
import path from 'path';

export interface MCPCatalogServer {
  name: string;
  displayName: string;
  contractVersion: string;
  port: number;
  endpoint: string;
  description?: string;
  tools: Array<{
    name: string;
    description: string;
    contractVersion: string;
  }>;
}

export interface MCPCatalog {
  catalogVersion: string;
  generatedAt: string;
  notes: string;
  servers: MCPCatalogServer[];
}

/**
 * Load the MCP catalog from the canonical location
 * @returns Parsed catalog or null if not found/invalid
 */
export function loadMCPCatalog(): MCPCatalog | null {
  try {
    // Catalog is at repo root: docs/mcp/catalog.json
    const catalogPath = path.join(process.cwd(), '..', 'docs', 'mcp', 'catalog.json');
    
    if (!fs.existsSync(catalogPath)) {
      console.warn('[MCP Catalog] Catalog file not found at:', catalogPath);
      return null;
    }

    const catalogContent = fs.readFileSync(catalogPath, 'utf-8');
    const catalog: MCPCatalog = JSON.parse(catalogContent);
    
    return catalog;
  } catch (error) {
    console.error('[MCP Catalog] Error loading catalog:', error);
    return null;
  }
}

/**
 * Get list of all MCP servers from the catalog
 * @returns Array of server definitions
 */
export function getMCPServersFromCatalog(): MCPCatalogServer[] {
  const catalog = loadMCPCatalog();
  return catalog?.servers || [];
}

/**
 * Get a specific MCP server by name from the catalog
 * @param name Server name (e.g., "github", "deploy", "observability")
 * @returns Server definition or null if not found
 */
export function getMCPServerByName(name: string): MCPCatalogServer | null {
  const catalog = loadMCPCatalog();
  return catalog?.servers.find(s => s.name === name) || null;
}
