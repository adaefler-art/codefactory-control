# Contracts (Source of Truth)

This folder is the **canonical source of truth** for cross-repo API contracts. Any engine or UI change that touches a documented API must first update the relevant contract here.

## Principles
- **Contract-first**: implement changes only after the contract is updated.
- **No silent drift**: new endpoints or response fields must be reflected here.
- **Minimal diffs**: keep updates focused on contract changes only.

## Ownership
- **Owner**: codefactory-control (Governance/Decision Loop)
- **Consumers**: codefactory-engine, codefactory-ui

## Mirror Rules
- codefactory-engine and codefactory-ui must **mirror** the contract defined here.
- Any deviations must be explicitly marked as **TBD** or **Open Questions** in the contract.

## Verification
Run the contract check from the repo root:

- PowerShell: `node scripts/verify-contracts.mjs`

## Contracts
- Engine HTTP Contract v1: [engine-api.v1.md](engine-api.v1.md)
