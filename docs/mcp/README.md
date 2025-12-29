# MCP (Model Context Protocol)

This folder documents how AFU-9 uses MCP as the boundary between the Control Center (client/orchestrator) and domain-specific tool providers (servers).

## Where to look

- **Protocol + JSON-RPC shape**: [docs/architecture/mcp-protocol.md](../architecture/mcp-protocol.md)
- **Tool catalog (canonical contracts)**: [docs/mcp/catalog.json](../mcp/catalog.json)
- **Server implementations (GitHub/Deploy/Observability)**: [mcp-servers/README.md](../../mcp-servers/README.md)
- **Standard health semantics**: [docs/CONTROL_PLANE_SPEC.md](../CONTROL_PLANE_SPEC.md)
- **Control Center HTTP surface (incl. `/api/mcp/health`)**: [docs/API_ROUTES.md](../API_ROUTES.md)

## Architecture (high level)

- **Control Center** acts as the **MCP Client**.
- **MCP Servers** expose tools via **HTTP + JSON-RPC 2.0**.
- Each MCP server also exposes conventional health endpoints:
  - `GET /health` (liveness)
  - `GET /ready` (readiness + dependency checks)

Server code lives in `mcp-servers/`.

### Default local ports (must match UI config)

- Observability: `http://localhost:3001`
- Deploy: `http://localhost:3002`
- GitHub: `http://
