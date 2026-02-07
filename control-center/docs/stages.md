# AFU-9 Stages

## How to add S4 (Review) in 3 steps
1. Extend the stage registry entry for S4 in src/lib/stage-registry.ts (routes, handler, capabilities, feature flags).
2. Implement the S4 API route and use the registry entry for handler headers and requirement gating.
3. Add or update tests to cover the S4 route and ensure the registry tests pass.

## Definition of Done (DoD)
- Stage registry entry exists for S4 with required route metadata.
- Route handler reads handler/capability requirements from the registry.
- Missing registry entry returns ENGINE_MISCONFIGURED with "missing registry entry S4".
- Registry tests include S4 and required route checks pass.
- Documentation updated with any new flags or requirements.
