# Auth Contract Review — Engine ↔ Control ↔ UI

## Auth Contract (Soll)

**Canonical source:** `docs/architecture/afu9-runtime-policy.md`

- **Engine ↔ Control-Center Service Auth (binding)**
  - Header: `x-afu9-service-token`
  - Engine env: `CONTROL_CENTER_SERVICE_TOKEN`
  - Control env: `SERVICE_READ_TOKEN`
  - Reference: `docs/architecture/afu9-runtime-policy.md`

- **UI → Engine (same-origin proxy)**
  - UI exposes `/api/engine/*` proxy to `ENGINE_BASE_URL`
  - Service token for proxy requests documented as `ENGINE_SERVICE_TOKEN`
  - Reference: `codefactory-ui/README.md`, `codefactory-ui/docs/route-discovery-afu9.md`

- **User Session Auth (UI)**
  - NextAuth + Cognito; JWT session with configurable maxAge/updateAge
  - Reference: `codefactory-ui/src/lib/auth.ts`

- **Engine readiness for GitHub mirror**
  - Required envs include `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_REPO_ALLOWLIST`
  - Reference: `codefactory-engine/docs/contracts/ready.md`

## Ist-Implementierung (Code)

### UI → Engine proxy
- **Auth gate:** NextAuth session check for mutation methods
- **Service token header:** `X-AFU9-SERVICE-TOKEN` injected when present
- **Env:** `AFU9_SERVICE_TOKEN` or `ENGINE_SERVICE_TOKEN`
- **Reference:** `codefactory-ui/src/app/api/engine/[...path]/route.ts`

### Engine → Control (handoff)
- **Control base URL env:** `CONTROL_CENTER_BASE_URL`
- **Control service token env:** `CONTROL_CENTER_SERVICE_TOKEN`
- **Header sent to Control:** `x-afu9-service-token`
- **Reference:** `codefactory-engine/api/issues/[issueId]/handoff.ts`

### Control Center auth behavior
- **Service token allowlist applies only to GET read routes**
  - `GET /api/issues`, `GET /api/afu9/issues`, and GET by id
- **Service token extraction supports:**
  - `Authorization: Bearer <token>`
  - `x-afu9-service-token`
  - `x-service-token`
- **Reference:**
  - `control-center/proxy.ts` (service token allowlist)
  - `control-center/app/api/issues/_shared.ts` (token extraction)
  - `control-center/app/api/issues/route.ts` (auth model)

## Drift / Mismatch (konkret)

- **Contract says Engine ↔ Control uses service token for Engine requests,** but **Control middleware only allows service token for GET read routes.**
- **POST `/api/issues/:id/handoff` is not a service-read route** in `control-center/proxy.ts`, so Control still enforces JWT (`x-afu9-sub`) and can return 401/403 even with valid service token.

**Conflict:**
- Contract: service token is valid for Engine → Control (binding)
- Code: service token bypass applies only to GET (read routes)

## Fix-Empfehlung

**Option A (align code with contract):**
- Allow service token for POST `/api/issues/:id/handoff` in Control middleware.
- Change in `control-center/proxy.ts` inside `isServiceReadRoute` (or add a new allowlist for service-write routes).
- Keep header `x-afu9-service-token` and env `SERVICE_READ_TOKEN`.

**Option B (align contract with code):**
- Document that service token is only valid for GET/read routes and requires JWT for POST handoff.
- If writing, add a new explicit service-write token (e.g. `SERVICE_WRITE_TOKEN`) and allow it for handoff.

## Key References

- **Canonical policy:** `docs/architecture/afu9-runtime-policy.md`
- **Engine ↔ Control contract (inventory):** `docs/epic1_v09_inventory.md`
- **UI proxy contract:** `codefactory-ui/README.md`
- **UI route discovery:** `codefactory-ui/docs/route-discovery-afu9.md`
- **Control middleware:** `control-center/proxy.ts`
- **Control service token extraction:** `control-center/app/api/issues/_shared.ts`
- **Engine handoff to Control:** `codefactory-engine/api/issues/[issueId]/handoff.ts`
- **Engine ready contract:** `codefactory-engine/docs/contracts/ready.md`
