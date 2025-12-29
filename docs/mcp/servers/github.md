# MCP Server: GitHub

## Endpoint
Default: http://localhost:3003

## Purpose
Kapselt alle GitHub-Operationen über die GitHub App (server-to-server).

## Tools
Siehe `docs/mcp/catalog.json` (serverId: github).

## Security
- Secrets nur serverseitig
- Minimal erforderliche Permissions
- Keine Tokens ins UI leaken

## Evidence Standard
- correlationId
- requestId (falls mutierend)
- GitHub response ids (issue number, pr number)
